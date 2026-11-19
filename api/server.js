import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { classifyMarket, createExchange, exchangeConnectionStatus, listExchangeCatalog, withExchange } from './exchanges.js';
import { assertLiveTradingAllowed, orderSchema, requirePrivateApiAuth } from './policy.js';

const app = express();
const port = Number(process.env.JPTI_API_PORT || 8787);
const host = process.env.JPTI_API_HOST || '127.0.0.1';
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb', strict: true }));

// A small per-process throttle protects local development endpoints from accidental request loops.
const windows = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const key = req.ip || 'local';
  const current = windows.get(key) || { start: now, count: 0 };
  if (now - current.start > 60_000) { current.start = now; current.count = 0; }
  current.count += 1;
  windows.set(key, current);
  if (current.count > 180) return res.status(429).json({ error: 'Rate limit exceeded. Retry in one minute.' });
  next();
});

if (!['127.0.0.1', '::1', 'localhost'].includes(host) && (!process.env.JPTI_ALLOW_REMOTE_API || process.env.JPTI_ALLOW_REMOTE_API !== 'true' || !process.env.JPTI_API_TOKEN)) {
  throw new Error('Remote API binding requires JPTI_ALLOW_REMOTE_API=true and a strong JPTI_API_TOKEN. Keep localhost binding for development.');
}

app.get('/api/health', (_req, res) => res.json({
  status: 'ok',
  service: 'JPTI Exchange Gateway',
  mode: process.env.JPTI_TRADING_MODE || 'paper',
  liveTradingEnabled: process.env.JPTI_ENABLE_LIVE_TRADING === 'true',
  timestamp: new Date().toISOString()
}));

app.get('/api/exchanges', (_req, res) => res.json({
  adapter: 'CCXT',
  count: listExchangeCatalog().length,
  exchanges: listExchangeCatalog()
}));

app.get('/api/exchanges/:id/status', (req, res) => {
  const status = exchangeConnectionStatus(req.params.id.toLowerCase());
  if (!status.supported) return res.status(404).json({ error: 'Unsupported exchange.' });
  res.json({ id: req.params.id.toLowerCase(), ...status });
});

app.get('/api/exchanges/:id/markets', async (req, res, next) => {
  const id = req.params.id.toLowerCase();
  const requestedType = String(req.query.type || 'all').toLowerCase();
  const search = String(req.query.search || '').trim().toLowerCase().slice(0, 60);
  const allowedTypes = ['all', 'spot', 'futures', 'perpetual', 'margin', 'cfd', 'options'];
  if (!allowedTypes.includes(requestedType)) return res.status(400).json({ error: 'Unsupported market type filter.', allowedTypes });
  try {
    const result = await withExchange(id, { privateAccess: false }, async (exchange) => {
      const all = Object.values(exchange.markets).filter((market) => market.active !== false).map((market) => {
        const meta = classifyMarket(market);
        return { symbol: market.symbol, id: market.id, base: market.base, quote: market.quote, settle: market.settle || null,
          active: market.active, type: meta.type, categories: meta.categories, spot: market.spot === true,
          margin: meta.categories.includes('margin'), swap: market.swap === true, future: market.future === true,
          option: market.option === true, cfd: meta.categories.includes('cfd'), contract: meta.contract,
          linear: meta.linear, inverse: meta.inverse, precision: market.precision, limits: market.limits };
      });
      const markets = all.filter((market) => {
        const matchesType = requestedType === 'all' || market.categories.includes(requestedType) ||
          (requestedType === 'futures' && market.categories.includes('perpetual'));
        const matchesSearch = !search || [market.symbol, market.base, market.quote].some((v) => String(v || '').toLowerCase().includes(search));
        return matchesType && matchesSearch;
      });
      return { markets, totalMarkets: all.length,
        counts: Object.fromEntries(['spot','futures','perpetual','margin','cfd','options'].map((type) => [type, all.filter((m) => m.categories.includes(type) || (type === 'futures' && m.categories.includes('perpetual'))).length])),
        timeframes: exchange.timeframes ? Object.keys(exchange.timeframes) : null,
        capabilities: { fetchTicker: Boolean(exchange.has?.fetchTicker), fetchOHLCV: Boolean(exchange.has?.fetchOHLCV),
          fetchOrderBook: Boolean(exchange.has?.fetchOrderBook), fetchFundingRate: Boolean(exchange.has?.fetchFundingRate),
          fetchPositions: Boolean(exchange.has?.fetchPositions), createOrder: Boolean(exchange.has?.createOrder) },
        fetchedAt: new Date().toISOString() };
    });
    res.set('Cache-Control', 'no-store');
    res.json({ exchange: id, filter: requestedType, count: result.markets.length, ...result });
  } catch (error) { next(error); }
});

app.get('/api/exchanges/:id/ticker/:symbol', async (req, res, next) => {
  const id = req.params.id.toLowerCase();
  const symbol = req.params.symbol.toUpperCase().replace('-', '/');
  try {
    const ticker = await withExchange(id, { privateAccess: false }, async (exchange) => {
      if (!exchange.markets[symbol]) throw Object.assign(new Error(`Unknown market symbol: ${symbol}`), { status: 404 });
      if (!exchange.has?.fetchTicker) throw Object.assign(new Error('Ticker endpoint unavailable for this exchange.'), { status: 501 });
      return exchange.fetchTicker(symbol);
    });
    res.json({
      exchange: id, symbol, timestamp: ticker.timestamp,
      datetime: ticker.datetime, last: ticker.last, bid: ticker.bid, ask: ticker.ask,
      high: ticker.high, low: ticker.low, baseVolume: ticker.baseVolume,
      quoteVolume: ticker.quoteVolume, percentage: ticker.percentage
    });
  } catch (error) { next(error); }
});

app.get('/api/exchanges/:id/ohlcv/:symbol', async (req, res, next) => {
  const id = req.params.id.toLowerCase();
  const symbol = req.params.symbol.toUpperCase().replace('-', '/');
  const timeframe = String(req.query.timeframe || '1h');
  const limit = Math.min(500, Math.max(20, Number.parseInt(req.query.limit || '120', 10) || 120));
  try {
    const candles = await withExchange(id, { privateAccess: false }, async (exchange) => {
      if (!exchange.markets[symbol]) throw Object.assign(new Error(`Unknown market symbol: ${symbol}`), { status: 404 });
      if (!exchange.has?.fetchOHLCV) throw Object.assign(new Error('OHLCV candles are unavailable for this exchange.'), { status: 501 });
      if (exchange.timeframes && !exchange.timeframes[timeframe]) throw Object.assign(new Error(`Unsupported timeframe: ${timeframe}`), { status: 400 });
      return exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    });
    res.json({ exchange: id, symbol, timeframe, candles });
  } catch (error) { next(error); }
});

app.get('/api/exchanges/:id/balance', async (req, res, next) => {
  try { requirePrivateApiAuth(req); } catch (error) { return res.status(error.status || 401).json({ error: error.message }); }
  const id = req.params.id.toLowerCase();
  try {
    const balance = await withExchange(id, { privateAccess: true }, async (exchange) => {
      if (!exchange.has?.fetchBalance) throw Object.assign(new Error('Balance endpoint unavailable for this exchange.'), { status: 501 });
      return exchange.fetchBalance();
    });
    res.json({ exchange: id, timestamp: new Date().toISOString(), free: balance.free, used: balance.used, total: balance.total });
  } catch (error) { next(error); }
});

app.post('/api/exchanges/:id/orders', async (req, res, next) => {
  const id = req.params.id.toLowerCase();
  try {
    const order = orderSchema.parse(req.body);
    const result = await withExchange(id, { privateAccess: true }, async (exchange) => {
      const market = exchange.market(order.symbol);
      if (order.type === 'market' && !exchange.has?.fetchTicker) throw Object.assign(new Error('Ticker endpoint required for market-order risk checks.'), { status: 501 });
      const ticker = order.type === 'market' ? await exchange.fetchTicker(order.symbol) : null;
      const price = order.type === 'limit' ? order.price : ticker?.last;
      const risk = assertLiveTradingAllowed(req, exchange, market, order, price);
      const params = order.clientOrderId ? { clientOrderId: order.clientOrderId } : {};
      const created = await exchange.createOrder(order.symbol, order.type, order.side, order.amount, order.type === 'limit' ? order.price : undefined, params);
      return { id: created.id, clientOrderId: created.clientOrderId, symbol: created.symbol, side: created.side, type: created.type, amount: created.amount, price: created.price, status: created.status, timestamp: created.timestamp, risk };
    });
    res.status(201).json({ exchange: id, order: result });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: 'Invalid request', details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  }
  const status = Number.isInteger(error.status) ? error.status : 502;
  // Do not return request configs, headers, or raw exchange objects to clients.
  res.status(status).json({ error: error.message || 'Exchange gateway error', name: error.name || 'Error' });
});

app.listen(port, host, () => {
  console.log(`JPTI API listening on http://${host}:${port}`);
  console.log(`Trading mode: ${process.env.JPTI_TRADING_MODE || 'paper'} | Live orders enabled: ${process.env.JPTI_ENABLE_LIVE_TRADING === 'true'}`);
});
