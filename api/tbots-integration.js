import express from 'express';
import { withExchange } from './exchanges.js';
import { requirePrivateApiAuth } from './policy.js';
import { getLedgerTransactions, ingestLedgerEvent } from './operations.js';

export const tbotsRouter = express.Router();
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

export function scoreSharedMarketContext({ momentumPct = null, imbalance = null, fundingRate = null } = {}) {
  let riskScore = 50;
  if (finite(momentumPct) !== null) riskScore += Math.max(-25, Math.min(25, Number(momentumPct) * 3));
  if (finite(imbalance) !== null) riskScore += Number(imbalance) * 15;
  if (finite(fundingRate) !== null) riskScore -= Math.max(-10, Math.min(10, Number(fundingRate) * 10000));
  riskScore = Math.max(0, Math.min(100, riskScore));
  return { riskScore, regime: riskScore < 35 ? 'risk_off' : riskScore > 65 ? 'risk_on' : 'neutral' };
}

tbotsRouter.get('/integrations/tbots/status', (_req, res) => res.json({
  integration: 'T-Bots',
  sourceRepository: 'https://github.com/kyleel2249/T-Bots',
  runtime: 'embedded-paper-engine',
  executionMode: 'paper-only',
  sharedMemory: 'JPTI append-only transaction/event ledger',
  liveWalletExecution: false,
  note: 'T-Bots live mode reads DEX market data but its executor remains simulated.'
}));

tbotsRouter.get('/integrations/tbots/memory', async (req, res) => {
  try {
    requirePrivateApiAuth(req);
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit || '50', 10) || 50));
    const events = (await getLedgerTransactions())
      .filter(event => event.source === 'tbots' && String(event.eventType).startsWith('bot_'))
      .slice(-limit).reverse();
    res.set('Cache-Control', 'no-store');
    res.json({ count: events.length, events });
  } catch (error) { res.status(error.status || 401).json({ error: error.message }); }
});

tbotsRouter.post('/integrations/tbots/events', async (req, res) => {
  try {
    requirePrivateApiAuth(req);
    const body = req.body || {};
    const allowed = new Set(['bot_signal', 'bot_decision', 'bot_trade', 'bot_filter', 'bot_session']);
    if (!allowed.has(body.eventType)) return res.status(400).json({ error: 'Unsupported T-Bots event type.' });
    const externalId = String(body.externalId || '').trim();
    if (externalId.length < 3 || externalId.length > 128) return res.status(400).json({ error: 'A stable externalId (3-128 chars) is required.' });
    const metadata = {};
    for (const [key, value] of Object.entries(body.metadata || {}).slice(0, 24)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) metadata[String(key).slice(0, 48)] = value;
    }
    const result = await ingestLedgerEvent({
      source: 'tbots', eventType: body.eventType, externalId, accountId: 'tbots-paper',
      symbol: String(body.symbol || 'SOLANA-DEX').slice(0, 48),
      quantity: Math.max(0, finite(body.quantity) || 0),
      currency: 'USD',
      occurredAt: body.occurredAt && !Number.isNaN(Date.parse(body.occurredAt)) ? new Date(body.occurredAt).toISOString() : new Date().toISOString(),
      metadata: { ...metadata, runId: String(body.runId || '').slice(0, 96), executionMode: 'paper' }
    });
    res.status(result.duplicate ? 200 : 201).json({ stored: true, duplicate: result.duplicate, id: result.event.id });
  } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

tbotsRouter.get('/integrations/tbots/context', async (req, res) => {
  try {
    requirePrivateApiAuth(req);
    const exchangeId = String(req.query.exchange || 'binance').toLowerCase();
    const symbol = String(req.query.symbol || 'BTC/USDT').toUpperCase();
    if (!/^[A-Z0-9._-]{2,20}\/[A-Z0-9._-]{2,20}$/.test(symbol)) return res.status(400).json({ error: 'Use BASE/QUOTE symbol format.' });
    const context = await withExchange(exchangeId, { privateAccess: false }, async exchange => {
      if (!exchange.markets[symbol]) throw Object.assign(new Error('Market unavailable on selected JPTI venue.'), { status: 404 });
      const [ticker, candles, book, funding] = await Promise.all([
        exchange.has?.fetchTicker ? exchange.fetchTicker(symbol).catch(() => null) : null,
        exchange.has?.fetchOHLCV ? exchange.fetchOHLCV(symbol, '1h', undefined, 30).catch(() => null) : null,
        exchange.has?.fetchOrderBook ? exchange.fetchOrderBook(symbol, 20).catch(() => null) : null,
        exchange.has?.fetchFundingRate ? exchange.fetchFundingRate(symbol).catch(() => null) : null
      ]);
      const closes = (candles || []).map(c => finite(c[4])).filter(v => v > 0);
      const momentumPct = closes.length >= 2 ? (closes.at(-1) / closes[0] - 1) * 100 : null;
      const bidDepth = (book?.bids || []).slice(0, 10).reduce((sum, row) => sum + Number(row[0]) * Number(row[1]), 0);
      const askDepth = (book?.asks || []).slice(0, 10).reduce((sum, row) => sum + Number(row[0]) * Number(row[1]), 0);
      const imbalance = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : null;
      const fundingRate = finite(funding?.fundingRate);
      const { riskScore, regime } = scoreSharedMarketContext({ momentumPct, imbalance, fundingRate });
      return { exchange: exchangeId, symbol, fetchedAt: new Date().toISOString(),
        ticker: ticker ? { last: ticker.last, bid: ticker.bid, ask: ticker.ask, timestamp: ticker.timestamp } : null,
        momentum1hWindowPercent: momentumPct, orderBookImbalance: imbalance, fundingRate,
        riskScore, regime, observations: { candles: closes.length, orderBook: Boolean(book), funding: Boolean(funding) },
        caveat: 'A coarse BTC/selected-market regime proxy, not a Solana token valuation or trade signal. Use as an optional risk gate only.' };
    });
    res.set('Cache-Control', 'no-store');
    res.json(context);
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});
