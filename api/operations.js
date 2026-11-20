import express from 'express';
import { appendStoredEvent, appendUniqueLedgerEvent, getSyncCursor, getStorageStatus, readStoredEvents, setSyncCursor } from './storage.js';
import { acquireSchedulerLease, getSchedulerLeaseStatus, releaseSchedulerLease, schedulerLeaseConfig } from './scheduler-lease.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withExchange, listExchangeCatalog } from './exchanges.js';
import { calculateBalanceReconciliation } from './reconciliation.js';
import { getOperationalIntervals, providerDirectory } from './providers.js';
import { requirePrivateApiAuth } from './policy.js';

export const operationsRouter = express.Router();
const jobState = new Map();
let schedulerStarted = false;
let schedulerLeader = false;
let schedulerHeartbeat = null;
const schedulerTimers = new Map();
let lastMonitorPersistAt = 0;
const startedAt = new Date().toISOString();

export const eventSchema = z.object({
  source: z.string().min(2).max(48),
  eventType: z.enum(['fill', 'deposit', 'withdrawal', 'fee', 'transfer', 'adjustment', 'funding', 'interest', 'borrow', 'rebate', 'bot_signal', 'bot_decision', 'bot_trade', 'bot_filter', 'bot_session']),
  externalId: z.string().min(3).max(128),
  accountId: z.string().min(2).max(96),
  symbol: z.string().max(48).optional(),
  side: z.enum(['buy', 'sell']).optional(),
  quantity: z.number().finite().nonnegative().optional(),
  price: z.number().finite().nonnegative().optional(),
  fee: z.number().finite().nonnegative().optional(),
  feeCurrency: z.string().max(16).optional(),
  currency: z.string().max(16).optional(),
  occurredAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
});

async function readEvents(limit = 20000, kind = null) {
  return readStoredEvents(limit, kind);
}

async function persistEvent(event) {
  return appendStoredEvent(event);
}


export async function ingestLedgerEvent(input) {
  const parsed = eventSchema.parse(input);
  return persistLedgerTransaction(parsed);
}

export async function getLedgerTransactions() {
  return readStoredEvents(Number.MAX_SAFE_INTEGER, 'ledger-transaction');
}

async function persistLedgerTransaction(parsed) {
  const event = { id: randomUUID(), kind: 'ledger-transaction', ...parsed, occurredAt: parsed.occurredAt || new Date().toISOString(), ingestedAt: new Date().toISOString() };
  return appendUniqueLedgerEvent(event);
}


function job(id, intervalSeconds, status, detail, extra = {}) {
  const previous = jobState.get(id) || {};
  return {
    id, intervalSeconds, status, detail,
    lastRunAt: previous.lastRunAt || null,
    lastSuccessAt: previous.lastSuccessAt || null,
    lastError: previous.lastError || null,
    runCount: previous.runCount || 0,
    ...extra
  };
}

function setJob(id, patch) {
  jobState.set(id, { ...(jobState.get(id) || {}), ...patch });
}

async function marketMonitor() {
  const watchlist = String(process.env.JPTI_MONITOR_MARKETS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!watchlist.length) {
    setJob('market-monitor', { lastRunAt: new Date().toISOString(), runCount: (jobState.get('market-monitor')?.runCount || 0) + 1, status: 'waiting-for-watchlist', detail: 'Set JPTI_MONITOR_MARKETS=binance:BTC/USDT,bitget:ETH/USDT to enable real ticker monitoring.' });
    return;
  }
  const snapshots = await Promise.allSettled(watchlist.slice(0, 30).map(async (entry) => {
    const split = entry.indexOf(':');
    if (split < 1) throw new Error('Invalid watchlist item: ' + entry);
    const exchangeId = entry.slice(0, split).toLowerCase();
    const symbol = entry.slice(split + 1).toUpperCase();
    const ticker = await withExchange(exchangeId, { privateAccess: false }, async (exchange) => {
      if (!exchange.markets[symbol]) throw new Error('Unknown market ' + symbol + ' on ' + exchangeId);
      if (!exchange.has?.fetchTicker) throw new Error('Ticker unavailable on ' + exchangeId);
      return exchange.fetchTicker(symbol);
    });
    return { exchange: exchangeId, symbol, last: ticker.last, bid: ticker.bid, ask: ticker.ask, percentage: ticker.percentage, quoteVolume: ticker.quoteVolume, timestamp: ticker.timestamp };
  }));
  const successes = snapshots.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  const failures = snapshots.filter((x) => x.status === 'rejected').map((x) => x.reason?.message || 'Market monitor error');
  const persistEveryMs = Math.max(10, Number(process.env.JPTI_MONITOR_PERSIST_INTERVAL_SECONDS || 60)) * 1000;
  if (successes.length && Date.now() - lastMonitorPersistAt >= persistEveryMs) {
    await persistEvent({ id: randomUUID(), kind: 'market-monitor-snapshot', occurredAt: new Date().toISOString(), markets: successes });
    lastMonitorPersistAt = Date.now();
  }
  setJob('market-monitor', {
    lastRunAt: new Date().toISOString(), lastSuccessAt: successes.length ? new Date().toISOString() : (jobState.get('market-monitor')?.lastSuccessAt || null),
    runCount: (jobState.get('market-monitor')?.runCount || 0) + 1,
    status: failures.length ? (successes.length ? 'partial' : 'degraded') : 'live',
    detail: successes.length + ' live ticker(s) sampled; ' + failures.length + ' failed.',
    lastError: failures.length ? failures.join('; ').slice(0, 500) : null,
    lastSnapshot: successes
  });
}

async function exchangeFillMonitor() {
  const watchlist = String(process.env.JPTI_FILL_SYNC_MARKETS || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 20);
  if (!watchlist.length) {
    setJob('fill-ingestion', { lastRunAt: new Date().toISOString(), runCount: (jobState.get('fill-ingestion')?.runCount || 0) + 1,
      status: 'waiting-for-watchlist', detail: 'Set JPTI_FILL_SYNC_MARKETS=binance:BTC/USDT,bitget:ETH/USDT to enable private fill-history polling.' });
    return;
  }
  const outcomes = await Promise.allSettled(watchlist.map(async entry => {
    const split = entry.indexOf(':');
    if (split < 1) throw new Error('Invalid fill watchlist entry: ' + entry);
    const exchangeId = entry.slice(0, split).toLowerCase(), symbol = entry.slice(split + 1).toUpperCase();
    const cursorKey = exchangeId + ':' + symbol;
    const since = await getSyncCursor(cursorKey, Date.now() - 24 * 60 * 60 * 1000);
    const trades = await withExchange(exchangeId, { privateAccess: true }, async ex => {
      if (!ex.has?.fetchMyTrades) throw new Error('fetchMyTrades unavailable on ' + exchangeId);
      if (!ex.markets[symbol]) throw new Error('Unknown fill-watchlist market ' + symbol);
      return ex.fetchMyTrades(symbol, since, 100);
    });
    let newest = since, ingested = 0, duplicates = 0;
    for (const trade of trades) {
      if (!trade.id || !trade.symbol || !['buy','sell'].includes(trade.side) || !(trade.amount > 0) || !(trade.price > 0)) continue;
      const [base, quote] = trade.symbol.split('/');
      const fee = trade.fee || {};
      const saved = await persistLedgerTransaction(eventSchema.parse({ source: exchangeId, eventType: 'fill', externalId: String(trade.id),
        accountId: exchangeId, symbol: trade.symbol, side: trade.side, quantity: Number(trade.amount), price: Number(trade.price),
        fee: Number(fee.cost || 0), feeCurrency: fee.currency || quote,
        occurredAt: new Date(Number(trade.timestamp) || Date.parse(trade.datetime) || Date.now()).toISOString(),
        metadata: { base, quote, orderId: String(trade.order || ''), tradeId: String(trade.id) } }));
      if (saved.duplicate) duplicates++; else ingested++;
      newest = Math.max(newest, Number(trade.timestamp || Date.parse(trade.datetime) || newest));
    }
    await setSyncCursor(cursorKey, trades.length ? newest + 1 : Date.now() - 60_000);
    return { exchange: exchangeId, symbol, fetched: trades.length, ingested, duplicates };
  }));
  const success = outcomes.filter(x => x.status === 'fulfilled').map(x => x.value);
  const errors = outcomes.filter(x => x.status === 'rejected').map(x => x.reason?.message || 'Fill sync failed');
  setJob('fill-ingestion', { lastRunAt: new Date().toISOString(), lastSuccessAt: success.length ? new Date().toISOString() : (jobState.get('fill-ingestion')?.lastSuccessAt || null),
    runCount: (jobState.get('fill-ingestion')?.runCount || 0) + 1, status: errors.length ? (success.length ? 'partial' : 'degraded') : 'live',
    detail: success.reduce((n,x) => n + x.ingested, 0) + ' new fill(s) ingested across ' + success.length + ' market(s); ' + errors.length + ' errors.',
    lastError: errors.length ? errors.join('; ').slice(0, 500) : null, lastSnapshot: success });
}

function configuredOpeningBalances(exchangeId) {
  try {
    const parsed = JSON.parse(process.env.JPTI_RECONCILE_OPENING_BALANCES_JSON || '{}');
    return parsed?.[exchangeId] && typeof parsed[exchangeId] === 'object' ? parsed[exchangeId] : {};
  } catch { return {}; }
}

async function balanceReconciliationMonitor() {
  const requested = String(process.env.JPTI_RECONCILE_EXCHANGES || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const configured = listExchangeCatalog().filter(item => item.configured).map(item => item.id);
  const exchangeIds = (requested.length ? requested : configured).filter((id, index, all) => all.indexOf(id) === index).slice(0, 10);
  if (!exchangeIds.length) {
    setJob('reconciliation', { lastRunAt:new Date().toISOString(), runCount:(jobState.get('reconciliation')?.runCount || 0) + 1,
      status:'waiting-for-credentials', detail:'Configure read-only exchange credentials and JPTI_RECONCILE_OPENING_BALANCES_JSON to run account balance reconciliation.' });
    return;
  }
  const events = await getLedgerTransactions();
  const outcomes = await Promise.allSettled(exchangeIds.map(async exchangeId => {
    const balance = await withExchange(exchangeId, {privateAccess:true}, async ex => {
      if (!ex.has?.fetchBalance) throw new Error('Balance endpoint unavailable on ' + exchangeId);
      return ex.fetchBalance();
    });
    const reconciliation = calculateBalanceReconciliation({ events:events.filter(e => e.source === exchangeId || e.accountId === exchangeId), balances:balance, openingBalances:configuredOpeningBalances(exchangeId) });
    const snapshot = { kind:'balance-reconciliation-snapshot', id:randomUUID(), exchange:exchangeId, occurredAt:new Date().toISOString(), ...reconciliation };
    await persistEvent(snapshot);
    return snapshot;
  }));
  const success = outcomes.filter(x => x.status === 'fulfilled').map(x => x.value);
  const errors = outcomes.filter(x => x.status === 'rejected').map(x => x.reason?.message || 'Balance reconciliation failed');
  const mismatch = success.filter(x => x.status === 'mismatch').length;
  const baseline = success.filter(x => x.status === 'baseline_required').length;
  setJob('reconciliation', { lastRunAt:new Date().toISOString(), lastSuccessAt:success.length ? new Date().toISOString() : (jobState.get('reconciliation')?.lastSuccessAt || null),
    runCount:(jobState.get('reconciliation')?.runCount || 0) + 1, status:errors.length ? (success.length ? 'partial' : 'degraded') : mismatch ? 'mismatch' : baseline ? 'baseline-required' : 'matched',
    detail:success.length + ' account(s) checked; ' + mismatch + ' mismatch(es); ' + baseline + ' require opening baselines; ' + errors.length + ' failed.',
    lastError:errors.length ? errors.join('; ').slice(0,500) : null, lastSnapshot:success });
}
async function providerMonitor() {
  const providers = providerDirectory();
  const configured = providers.filter((p) => p.configured).length;
  setJob('provider-health', { lastRunAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), runCount: (jobState.get('provider-health')?.runCount || 0) + 1, status: 'registry-checked', detail: configured + '/' + providers.length + ' providers have credentials or public access configured. This is not an authenticated connectivity test.' });
}

async function blockedTask(id, message) {
  setJob(id, { lastRunAt: new Date().toISOString(), runCount: (jobState.get(id)?.runCount || 0) + 1, status: 'waiting-for-prerequisites', detail: message });
}

function runSafely(id, task) {
  const current = jobState.get(id) || {};
  if (current.running) return;
  setJob(id, { running: true });
  Promise.resolve().then(task).catch((error) => {
    setJob(id, { lastRunAt: new Date().toISOString(), status: 'error', lastError: error.message, detail: error.message });
  }).finally(() => setJob(id, { running: false }));
}

function stopScheduledJobs() {
  for (const timer of schedulerTimers.values()) clearInterval(timer);
  schedulerTimers.clear();
  schedulerStarted = false;
  schedulerLeader = false;
}

function startScheduledJobs() {
  if (schedulerStarted || process.env.JPTI_SCHEDULER_ENABLED === 'false') return;
  schedulerStarted = true;
  const intervals = getOperationalIntervals();
  const jobs = [
    ['market-monitor', intervals.marketMonitorSeconds, marketMonitor],
    ['fill-ingestion', intervals.reconcileSeconds, exchangeFillMonitor],
    ['provider-health', intervals.providerHealthSeconds, providerMonitor],
    ['reconciliation', intervals.reconcileSeconds, balanceReconciliationMonitor],
    ['investor-monitor', intervals.investorMonitorSeconds, () => blockedTask('investor-monitor', 'Waiting for configured investor/watchlists and licensed holdings or disclosure feeds.')],
    ['market-maker', intervals.marketMakerIntervalSeconds, () => blockedTask('market-maker', 'Market-making is intentionally disabled. No quoting or order-placement worker is active.')],
    ['news-monitor', intervals.newsRefreshSeconds, () => blockedTask('news-monitor', 'News polling is not yet scheduled as a durable ingestion worker; provider search endpoints remain available.')],
    ['onchain-monitor', intervals.onchainRefreshSeconds, () => blockedTask('onchain-monitor', 'On-chain polling requires configured wallet watchlists and indexed event subscriptions. Address lookups remain on-demand.')]
  ];
  for (const [id, seconds, task] of jobs) {
    setJob(id, { intervalSeconds: seconds, status: 'starting', detail: 'Scheduler leader registered this worker.' });
    runSafely(id, task);
    const timer = setInterval(() => runSafely(id, task), seconds * 1000);
    timer.unref?.();
    schedulerTimers.set(id, timer);
  }
}

async function refreshSchedulerLeadership() {
  try {
    const acquired = await acquireSchedulerLease();
    if (acquired && !schedulerLeader) { schedulerLeader = true; startScheduledJobs(); }
    else if (!acquired && schedulerLeader) stopScheduledJobs();
    if (!acquired) {
      for (const id of ['market-monitor','fill-ingestion','provider-health','reconciliation','investor-monitor','market-maker','news-monitor','onchain-monitor']) {
        if (!jobState.get(id)?.running) setJob(id, { status: 'standby', detail: 'Another JPTI instance currently owns the scheduler lease.' });
      }
    }
  } catch (error) {
    stopScheduledJobs();
    for (const id of ['market-monitor','fill-ingestion','provider-health','reconciliation','investor-monitor','market-maker','news-monitor','onchain-monitor']) {
      setJob(id, { status: 'coordination-error', lastError: error.message, detail: 'Scheduler paused because its leadership lease could not be verified.' });
    }
  }
}

export async function startOperationsScheduler() {
  if (schedulerHeartbeat || process.env.JPTI_SCHEDULER_ENABLED === 'false') return;
  const { heartbeatMs } = schedulerLeaseConfig();
  await refreshSchedulerLeadership();
  schedulerHeartbeat = setInterval(refreshSchedulerLeadership, heartbeatMs);
  schedulerHeartbeat.unref?.();
}

export async function stopOperationsScheduler() {
  if (schedulerHeartbeat) clearInterval(schedulerHeartbeat);
  schedulerHeartbeat = null;
  stopScheduledJobs();
  try { await releaseSchedulerLease(); } catch (error) { console.error('JPTI scheduler lease release failed:', error.message); }
}
export function getOperationsSnapshot() {
  const intervals = getOperationalIntervals();
  const definitions = [
    ['market-monitor', intervals.marketMonitorSeconds, 'Market monitoring'],
    ['fill-ingestion', intervals.reconcileSeconds, 'Exchange fill ingestion'],
    ['provider-health', intervals.providerHealthSeconds, 'Provider registry health'],
    ['reconciliation', intervals.reconcileSeconds, 'Portfolio reconciliation'],
    ['investor-monitor', intervals.investorMonitorSeconds, 'Investor monitoring'],
    ['market-maker', intervals.marketMakerIntervalSeconds, 'Market-making'],
    ['news-monitor', intervals.newsRefreshSeconds, 'News ingestion'],
    ['onchain-monitor', intervals.onchainRefreshSeconds, 'On-chain monitoring']
  ];
  return {
    generatedAt: new Date().toISOString(),
    storage: getStorageStatus(),
    scheduler: { ...getSchedulerLeaseStatus(), leader: schedulerLeader, running: schedulerStarted },
    startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    schedulerEnabled: intervals.schedulerEnabled,
    jobs: definitions.map(([id, seconds, label]) => job(id, seconds, jobState.get(id)?.status || 'not-started', jobState.get(id)?.detail || 'Scheduler has not started.', { label, ...(jobState.get(id) || {}) }))
  };
}

operationsRouter.get('/operations/overview', (_req, res) => res.json(getOperationsSnapshot()));
operationsRouter.get('/operations/events', async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit || '100', 10) || 100));
    const events = (await readEvents(limit * 2)).filter((event) => event.kind !== 'ledger-transaction' && event.kind !== 'balance-reconciliation-snapshot').slice(-limit);
    res.json({ count: events.length, events: events.reverse() });
  } catch (error) { next(error); }
});
operationsRouter.get('/operations/ledger/summary', async (_req, res, next) => {
  try {
    const transactions = await readEvents(Number.MAX_SAFE_INTEGER, 'ledger-transaction');
    const byType = Object.fromEntries(['fill','deposit','withdrawal','fee','transfer','adjustment','funding','interest','borrow','rebate'].map((type) => [type, transactions.filter((e) => e.eventType === type).length]));
    res.json({ eventCount: transactions.length, byType, lastEventAt: transactions.at(-1)?.occurredAt || null, note: 'This is an append-only transaction event count, not a reconciled balance or realized PnL statement.' });
  } catch (error) { next(error); }
});

operationsRouter.get('/operations/reconciliation', async (req, res, next) => {
  try {
    requirePrivateApiAuth(req);
    const snapshots = (await readEvents()).filter(event => event.kind === 'balance-reconciliation-snapshot').slice(-50).reverse();
    res.json({ count:snapshots.length, snapshots, note:'Snapshots compare exchange-reported totals with configured opening balances and supported ledger movements. baseline_missing is not a zero balance.' });
  } catch (error) { next(error); }
});
operationsRouter.get('/operations/ledger/events', async (req, res, next) => {
  try {
    requirePrivateApiAuth(req);
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit || '100', 10) || 100));
    const events = (await readEvents(limit, 'ledger-transaction')).reverse();
    res.json({ count: events.length, events });
  } catch (error) { next(error); }
});

operationsRouter.post('/operations/ledger/events', async (req, res, next) => {
  try {
    requirePrivateApiAuth(req);
    const parsed = eventSchema.parse(req.body);
    const result = await persistLedgerTransaction(parsed);
    res.status(result.duplicate ? 200 : 201).json({ accepted: true, ...result });
  } catch (error) { next(error); }
});
