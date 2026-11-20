import express from 'express';
import { withExchange } from './exchanges.js';
import { requirePrivateApiAuth } from './policy.js';
import { ingestLedgerEvent, getLedgerTransactions } from './operations.js';

export const labRouter = express.Router();
const finite = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function ema(values, period) {
  const alpha = 2 / (period + 1), out = Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = values[i] * alpha + out[i - 1] * (1 - alpha);
  return out;
}
function metrics(returns) {
  let equity = 1, peak = 1, maxDrawdown = 0, wins = 0, losses = 0;
  const curve = [];
  for (const r of returns) {
    equity *= Math.max(1e-9, 1 + r);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    if (r > 0) wins++; else if (r < 0) losses++;
    curve.push(equity);
  }
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1) : 0;
  return { totalReturnPercent: (equity - 1) * 100, endingEquityMultiple: equity, maxDrawdownPercent: maxDrawdown * 100,
    observations: returns.length, positiveBars: wins, negativeBars: losses, winBarRatePercent: returns.length ? wins / returns.length * 100 : null,
    volatilityPerBarPercent: Math.sqrt(variance) * 100, equityCurve: curve };
}
function runEma(candles, fast, slow, feeBps = 10) {
  const closes = candles.map((c) => Number(c[4]));
  const a = ema(closes, fast), b = ema(closes, slow);
  let position = 0;
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    // A signal formed at candle i-1 is applied to candle i: no same-close look-ahead.
    const prior = i - 1;
    const nextPosition = a[prior] > b[prior] ? 1 : 0;
    const turnover = Math.abs(nextPosition - position);
    const gross = (closes[i] / closes[i - 1] - 1) * position;
    returns.push(gross - turnover * feeBps / 10000);
    position = nextPosition;
  }
  return returns;
}
function validateCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 100 || candles.some(c => !Array.isArray(c) || !Number.isFinite(Number(c[4])) || Number(c[4]) <= 0)) {
    throw new Error('At least 100 valid OHLCV candles with positive closes are required.');
  }
}
export function runWalkForward(candles, options = {}) {
  validateCandles(candles);
  const trainBars = clamp(Number(options.trainBars || 500), 100, 5000);
  const testBars = clamp(Number(options.testBars || 100), 20, 2000);
  const stepBars = clamp(Number(options.stepBars || testBars), 20, 2000);
  const feeBps = clamp(Number(options.feeBps ?? 10), 0, 500);
  const fastPeriods = [...new Set((options.fastPeriods || [5, 9, 12, 20]).map(Number).filter(x => Number.isInteger(x) && x >= 2 && x <= 100))];
  const slowPeriods = [...new Set((options.slowPeriods || [21, 30, 50, 100]).map(Number).filter(x => Number.isInteger(x) && x >= 3 && x <= 200))];
  const grid = fastPeriods.flatMap(fast => slowPeriods.filter(slow => slow > fast).map(slow => ({ fast, slow })));
  if (!grid.length || trainBars < Math.max(...slowPeriods, 30) + 5) throw new Error('Invalid parameter grid or training window.');
  const folds = [];
  let testStart = trainBars;
  while (testStart + testBars <= candles.length && folds.length < 50) {
    const training = candles.slice(testStart - trainBars, testStart);
    const testing = candles.slice(testStart - Math.max(...slowPeriods) - 2, testStart + testBars);
    let best = null;
    for (const p of grid) {
      const trainReturns = runEma(training, p.fast, p.slow, feeBps);
      const score = metrics(trainReturns);
      const objective = score.totalReturnPercent - score.maxDrawdownPercent * 0.5;
      if (!best || objective > best.objective) best = { ...p, objective, trainingReturnPercent: score.totalReturnPercent, trainingMaxDrawdownPercent: score.maxDrawdownPercent };
    }
    const warmup = Math.max(...slowPeriods) + 1;
    const testReturns = runEma(testing, best.fast, best.slow, feeBps).slice(warmup - 1);
    folds.push({ fold: folds.length + 1, trainStart: training[0][0], trainEnd: training.at(-1)[0], testStart: candles[testStart][0], testEnd: candles[Math.min(testStart + testBars - 1, candles.length - 1)][0],
      selectedParameters: { fast: best.fast, slow: best.slow }, trainingReturnPercent: best.trainingReturnPercent,
      trainingMaxDrawdownPercent: best.trainingMaxDrawdownPercent, outOfSample: metrics(testReturns) });
    testStart += stepBars;
  }
  if (!folds.length) throw new Error('Not enough candles for one complete walk-forward fold. Increase history or reduce trainBars/testBars.');
  const allOos = folds.flatMap(f => f.outOfSample.equityCurve.slice(1).map((v, i, a) => i === 0 ? v - 1 : v / a[i - 1] - 1));
  const oosMetrics = metrics(allOos);
  return { method: 'rolling anchored-window parameter selection with strictly subsequent out-of-sample test windows',
    strategy: 'EMA crossover long/flat baseline', config: { trainBars, testBars, stepBars, feeBps, parameterCombinations: grid.length },
    folds, aggregateOutOfSample: { ...oosMetrics, equityCurve: undefined },
    caveats: ['Research baseline, not a profitability claim.', 'Fees are modeled; spread, funding, borrow, market impact, latency, partial fills and taxes are not.', 'Use venue-specific data quality checks and additional untouched holdout data before deployment.'] };
}
export function calculatePortfolioAccounting(events, marks = {}) {
  const ordered = [...events].filter(e => e.eventType === 'fill').sort((a,b) => new Date(a.occurredAt) - new Date(b.occurredAt));
  const positions = new Map(), realizedByQuote = {}, feesByCurrency = {};
  for (const e of ordered) {
    const [base, quote] = String(e.symbol || '').split('/');
    const qty = finite(e.quantity), price = finite(e.price), fee = finite(e.fee || 0);
    if (!base || !quote || qty == null || price == null || qty <= 0 || price <= 0) continue;
    const key = e.accountId + ':' + e.source + ':' + e.symbol;
    const p = positions.get(key) || { accountId: e.accountId, exchange: e.source, symbol: e.symbol, base, quote, quantity: 0, averageCost: 0, realizedPnl: 0, totalBought: 0, totalSold: 0 };
    const feeCurrency = e.feeCurrency || quote;
    if (fee > 0) feesByCurrency[feeCurrency] = (feesByCurrency[feeCurrency] || 0) + fee;
    if (e.side === 'buy') {
      const baseFee = feeCurrency === base ? fee : 0;
      const quoteFee = feeCurrency === quote ? fee : 0;
      const acquired = Math.max(0, qty - baseFee);
      const cost = qty * price + quoteFee;
      p.averageCost = (p.quantity * p.averageCost + cost) / Math.max(1e-12, p.quantity + acquired);
      p.quantity += acquired; p.totalBought += acquired;
    } else if (e.side === 'sell') {
      const disposed = qty + (feeCurrency === base ? fee : 0);
      const proceeds = qty * price - (feeCurrency === quote ? fee : 0);
      const matched = Math.min(p.quantity, disposed);
      p.realizedPnl += proceeds * (matched / disposed) - p.averageCost * matched;
      p.quantity -= matched; p.totalSold += matched;
      if (p.quantity <= 1e-12) { p.quantity = 0; p.averageCost = 0; }
    }
    positions.set(key, p);
    realizedByQuote[quote] = (realizedByQuote[quote] || 0) + p.realizedPnl - (p._reportedRealized || 0);
    p._reportedRealized = p.realizedPnl;
  }
  const rows = [...positions.values()].map(p => {
    const mark = finite(marks[p.symbol]);
    return { ...p, marketPrice: mark, unrealizedPnl: mark == null ? null : (mark - p.averageCost) * p.quantity,
      marketValue: mark == null ? null : mark * p.quantity, costBasis: p.averageCost * p.quantity,
      valuationStatus: mark == null ? 'mark-price-unavailable' : 'marked-from-supplied-price' };
  }).map(({ _reportedRealized, ...p }) => p);
  return { generatedAt: new Date().toISOString(), positions: rows, realizedPnlByQuoteCurrency: realizedByQuote, feesByCurrency,
    accountingMethod: 'weighted-average cost per exchange/account/symbol; FIFO is not implied',
    limitations: ['Only ingested fills are included. Deposits, withdrawals, transfers, funding, borrow interest, rebates and corporate actions require separate journal treatment.',
      'Realized PnL is quote-currency denominated and should not be summed across currencies without FX conversion.',
      'Unrealized PnL is reported only where a current mark price is supplied. This is not a tax statement.'] };
}

labRouter.post('/advanced/lab/walk-forward', (req, res) => {
  try { res.json(runWalkForward(req.body?.candles, req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
labRouter.get('/advanced/portfolio/accounting', async (req, res) => {
  try {
    requirePrivateApiAuth(req);
    const events = await getLedgerTransactions();
    const marks = {};
    const instruments = [...new Map(events.filter(e => e.eventType === 'fill' && e.symbol).map(e => [e.source + ':' + e.symbol, { exchange: e.source, symbol: e.symbol }])).values()].slice(0, 30);
    await Promise.all(instruments.map(async ({ exchange, symbol }) => {
      try {
        const price = await withExchange(exchange, { privateAccess: false }, async ex => ex.markets[symbol] && ex.has?.fetchTicker ? (await ex.fetchTicker(symbol)).last : null);
        if (finite(price) != null) marks[symbol] = price;
      } catch {}
    }));
    res.json(calculatePortfolioAccounting(events, marks));
  } catch (e) { res.status(e.status || 401).json({ error: e.message }); }
});
labRouter.post('/advanced/fills/sync/:exchange', async (req, res) => {
  try { requirePrivateApiAuth(req); } catch (e) { return res.status(401).json({ error: e.message }); }
  const exchangeId = req.params.exchange.toLowerCase();
  const since = finite(req.body?.since) ?? Date.now() - 24 * 60 * 60 * 1000;
  const symbol = req.body?.symbol ? String(req.body.symbol).toUpperCase() : undefined;
  try {
    const trades = await withExchange(exchangeId, { privateAccess: true }, async ex => {
      if (!ex.has?.fetchMyTrades) throw Object.assign(new Error('This exchange adapter does not expose fetchMyTrades.'), { status: 501 });
      if (symbol && !ex.markets[symbol]) throw Object.assign(new Error('Unknown market symbol.'), { status: 404 });
      return ex.fetchMyTrades(symbol, since, 100);
    });
    const results = [];
    for (const t of trades) {
      if (!t.id || !t.symbol || !['buy','sell'].includes(t.side) || !(t.amount > 0) || !(t.price > 0)) continue;
      const [base, quote] = t.symbol.split('/');
      const fee = t.fee || {};
      const saved = await ingestLedgerEvent({ source: exchangeId, eventType: 'fill', externalId: String(t.id), accountId: exchangeId,
        symbol: t.symbol, side: t.side, quantity: Number(t.amount), price: Number(t.price), fee: Number(fee.cost || 0),
        feeCurrency: fee.currency || quote, occurredAt: t.datetime || new Date(t.timestamp || Date.now()).toISOString(),
        metadata: { base, quote, orderId: String(t.order || ''), tradeId: String(t.id), takerOrMaker: String(t.takerOrMaker || '') } });
      results.push({ id: t.id, duplicate: saved.duplicate });
    }
    res.json({ exchange: exchangeId, fetched: trades.length, ingested: results.filter(x => !x.duplicate).length,
      duplicates: results.filter(x => x.duplicate).length, since: new Date(since).toISOString(),
      note: 'Read-only private trade-history ingestion. Venue history limits and pagination vary; repeat with a later since cursor for older history.' });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});
labRouter.get('/advanced/stream/:exchange/:symbol', async (req, res) => {
  const exchangeId = req.params.exchange.toLowerCase(), symbol = req.params.symbol.toUpperCase().replace('-', '/');
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  let busy = false, closed = false;
  req.on('close', () => { closed = true; });
  const publish = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const snapshot = await withExchange(exchangeId, { privateAccess: false }, async ex => {
        const market = ex.markets[symbol];
        if (!market) throw Object.assign(new Error('Market not found.'), { status: 404 });
        const jobs = {};
        if (ex.has?.fetchOrderBook) jobs.orderBook = ex.fetchOrderBook(symbol, 50);
        if (market.contract && ex.has?.fetchFundingRate) jobs.funding = ex.fetchFundingRate(symbol);
        if (market.contract && ex.has?.fetchOpenInterest) jobs.openInterest = ex.fetchOpenInterest(symbol);
        if (ex.has?.fetchTicker) jobs.ticker = ex.fetchTicker(symbol);
        const pairs = await Promise.all(Object.entries(jobs).map(async ([k,p]) => [k, await p]));
        return Object.fromEntries(pairs);
      });
      const payload = { exchange: exchangeId, symbol, sampledAt: new Date().toISOString(), ...snapshot,
        transport: 'server-sent events over polling; venue websocket capability is not assumed' };
      if (!closed) res.write('event: intelligence\ndata: ' + JSON.stringify(payload) + '\n\n');
    } catch (e) {
      if (!closed) res.write('event: error\ndata: ' + JSON.stringify({ exchange: exchangeId, symbol, error: e.message, sampledAt: new Date().toISOString() }) + '\n\n');
    } finally { busy = false; }
  };
  await publish();
  const timer = setInterval(publish, clamp(Number(req.query.intervalMs || 2000), 1000, 15000));
  req.on('close', () => clearInterval(timer));
});
