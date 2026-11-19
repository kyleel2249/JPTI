import express from 'express';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withExchange } from './exchanges.js';
import { getOperationalIntervals, providerDirectory } from './providers.js';
import { requirePrivateApiAuth } from './policy.js';

export const operationsRouter = express.Router();
const dataFile = resolve(process.env.JPTI_DATA_DIR || 'data', 'jpti-events.jsonl');
let writeQueue = Promise.resolve();
const jobState = new Map();
let schedulerStarted = false;
let lastMonitorPersistAt = 0;
const startedAt = new Date().toISOString();

const eventSchema = z.object({
  source: z.string().min(2).max(48),
  eventType: z.enum(['fill', 'deposit', 'withdrawal', 'fee', 'transfer', 'adjustment']),
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

async function readEvents(limit = 20000) {
  try {
    const raw = await readFile(dataFile, 'utf8');
    return raw.split('\n').filter(Boolean).slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function persistEvent(event) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(dataFile), { recursive: true });
    await appendFile(dataFile, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 });
  });
  await writeQueue;
  return event;
}


async function persistLedgerTransaction(parsed) {
  let result;
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const events = await readEvents();
    const duplicate = events.find((event) => event.kind === 'ledger-transaction' && event.source === parsed.source && event.accountId === parsed.accountId && event.externalId === parsed.externalId);
    if (duplicate) { result = { duplicate: true, event: duplicate }; return; }
    const event = { id: randomUUID(), kind: 'ledger-transaction', ...parsed, occurredAt: parsed.occurredAt || new Date().toISOString(), ingestedAt: new Date().toISOString() };
    await mkdir(dirname(dataFile), { recursive: true });
    await appendFile(dataFile, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 });
    result = { duplicate: false, event };
  });
  await writeQueue;
  return result;
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

export function startOperationsScheduler() {
  if (schedulerStarted || process.env.JPTI_SCHEDULER_ENABLED === 'false') return;
  schedulerStarted = true;
  const intervals = getOperationalIntervals();
  const jobs = [
    ['market-monitor', intervals.marketMonitorSeconds, marketMonitor],
    ['provider-health', intervals.providerHealthSeconds, providerMonitor],
    ['reconciliation', intervals.reconcileSeconds, () => blockedTask('reconciliation', 'Waiting for exchange fill-history ingestion and a verified account-to-ledger reconciliation adapter.')],
    ['investor-monitor', intervals.investorMonitorSeconds, () => blockedTask('investor-monitor', 'Waiting for configured investor/watchlists and licensed holdings or disclosure feeds.')],
    ['market-maker', intervals.marketMakerIntervalSeconds, () => blockedTask('market-maker', 'Market-making is intentionally disabled. No quoting or order-placement worker is active.')],
    ['news-monitor', intervals.newsRefreshSeconds, () => blockedTask('news-monitor', 'News polling is not yet scheduled as a durable ingestion worker; provider search endpoints remain available.')],
    ['onchain-monitor', intervals.onchainRefreshSeconds, () => blockedTask('onchain-monitor', 'On-chain polling requires configured wallet watchlists and indexed event subscriptions. Address lookups remain on-demand.')]
  ];
  for (const [id, seconds, task] of jobs) {
    setJob(id, { intervalSeconds: seconds, status: 'starting', detail: 'Scheduler registered.' });
    runSafely(id, task);
    const timer = setInterval(() => runSafely(id, task), seconds * 1000);
    timer.unref?.();
  }
}

export function getOperationsSnapshot() {
  const intervals = getOperationalIntervals();
  const definitions = [
    ['market-monitor', intervals.marketMonitorSeconds, 'Market monitoring'],
    ['provider-health', intervals.providerHealthSeconds, 'Provider registry health'],
    ['reconciliation', intervals.reconcileSeconds, 'Portfolio reconciliation'],
    ['investor-monitor', intervals.investorMonitorSeconds, 'Investor monitoring'],
    ['market-maker', intervals.marketMakerIntervalSeconds, 'Market-making'],
    ['news-monitor', intervals.newsRefreshSeconds, 'News ingestion'],
    ['onchain-monitor', intervals.onchainRefreshSeconds, 'On-chain monitoring']
  ];
  return {
    generatedAt: new Date().toISOString(),
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
    const events = await readEvents(limit);
    res.json({ count: events.length, events: events.reverse() });
  } catch (error) { next(error); }
});
operationsRouter.get('/operations/ledger/summary', async (_req, res, next) => {
  try {
    const events = await readEvents();
    const transactions = events.filter((e) => e.kind === 'ledger-transaction');
    const byType = Object.fromEntries(['fill','deposit','withdrawal','fee','transfer','adjustment'].map((type) => [type, transactions.filter((e) => e.eventType === type).length]));
    res.json({ eventCount: transactions.length, byType, lastEventAt: transactions.at(-1)?.occurredAt || null, note: 'This is an append-only transaction event count, not a reconciled balance or realized PnL statement.' });
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
