import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import helmet from 'helmet';
import { z } from 'zod';
import { classifyMarket, createExchange, exchangeConnectionStatus, listExchangeCatalog, withExchange } from './exchanges.js';
import { intelligenceRouter } from './intelligence.js';
import { providerRouter } from './providers.js';
import { operationsRouter, startOperationsScheduler, stopOperationsScheduler } from './operations.js';
import { initializeSchedulerLease, closeSchedulerLease } from './scheduler-lease.js';
import { initializeStorage, closeStorage } from './storage.js';
import { assertLiveTradingAllowed, orderSchema, requirePrivateApiAuth } from './policy.js';
import { buildCrossVenueComparison } from './market-intelligence.js';
import { advancedRouter } from './advanced-intelligence.js';
import { labRouter } from './advanced-lab.js';
import { tbotsRouter } from './tbots-integration.js';
import { universalRouter } from './universal-engine.js';
import { portfolioRouter } from './portfolio-intelligence.js';

const app = express();
const port = Number(process.env.PORT || process.env.JPTI_API_PORT || 8787);
const host = process.env.JPTI_API_HOST || '127.0.0.1';
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '32kb', strict: true }));

// Capacitor Android uses its own WebView origin. Only explicitly configured origins
// receive CORS permission; same-origin web and Cloudflare Pages proxy need no CORS.
const allowedCorsOrigins = new Set(String(process.env.JPTI_CORS_ORIGINS || 'https://localhost,capacitor://localhost').split(',').map(value => value.trim()).filter(Boolean));
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowedCorsOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, x-jpti-api-token, Authorization');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    if (!origin || !allowedCorsOrigins.has(origin)) return res.status(403).json({ error: 'This application origin is not permitted by JPTI CORS policy.' });
    return res.status(204).end();
  }
  next();
});

// Optional origin lock: when enabled, only the trusted Cloudflare Pages Function
// proxy may reach the API. Keep JPTI_EDGE_SECRET server-side on both platforms.
app.use('/api', (req, res, next) => {
  if (process.env.JPTI_REQUIRE_EDGE_SECRET !== 'true') return next();
  const expected = String(process.env.JPTI_EDGE_SECRET || '');
  const supplied = String(req.get('x-jpti-edge-secret') || '');
  if (expected.length < 32 || supplied !== expected) {
    return res.status(403).json({ error: 'API origin access is restricted to the configured trusted edge proxy.' });
  }
  next();
});

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

app.use('/api/intelligence', intelligenceRouter);
app.use('/api', providerRouter);
app.use('/api', operationsRouter);
app.use('/api', advancedRouter);
app.use('/api', portfolioRouter);
app.use('/api', labRouter);
app.use('/api', tbotsRouter);
app.use('/api', universalRouter);
// T-Bots is preserved as an independently versioned paper-trading subsystem.
app.use('/t-bots', express.static(resolve(process.env.JPTI_TBOTS_PUBLIC_DIR || 'integrations/t-bots/public'), { fallthrough: true, index: 'index.html' }));

app.get('/api/health', (_req, res) => res.json({
  status: 'ok',
  service: 'JPTI Exchange Gateway',
  mode: process.env.JPTI_TRADING_MODE || 'paper',
  liveTradingEnabled: process.env.JPTI_ENABLE_LIVE_TRADING === 'true',
  localPrivateAccess: process.env.JPTI_ALLOW_LOCAL_PRIVATE_ACCESS === 'true' && ['127.0.0.1', '::1', 'localhost'].includes(host),
  desktopInstanceId: process.env.JPTI_DESKTOP_INSTANCE_ID || null,
  timestamp: new Date().toISOString()
}));

app.get('/api/exchanges', (_req, res) => res.json({
  adapter: 'CCXT',
  count: listExchangeCatalog().length,
  exchanges: listExchangeCatalog()
}));


const crossVenueCache = new Map();
app.get('/api/exchanges/compare/ticker', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTC/USDT').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{2,20}\/[A-Z0-9._-]{2,20}$/.test(symbol)) return res.status(400).json({ error: 'Use a normalized BASE/QUOTE symbol, for example BTC/USDT.' });
  const requested = String(req.query.exchanges || 'binance,bitget,bybit,okx').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
  const exchangeIds = [...new Set(requested)].slice(0, 6);
  const supported = new Set(listExchangeCatalog().map((item) => item.id));
  const unsupported = exchangeIds.filter((id) => !supported.has(id));
  if (!exchangeIds.length) return res.status(400).json({ error: 'Select at least one exchange.' });
  if (unsupported.length) return res.status(400).json({ error: 'Unsupported exchange IDs.', unsupported });
  const cacheKey = symbol + '|' + exchangeIds.join(',');
  const cached = crossVenueCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 5000) return res.json({ ...cached.payload, cache: 'hit' });
  const results = await Promise.all(exchangeIds.map(async (id) => {
    try {
      const ticker = await withExchange(id, { privateAccess: false }, async (exchange) => {
        if (!exchange.has?.fetchTicker) throw Object.assign(new Error('Ticker capability unavailable.'), { status: 501 });
        if (!exchange.markets[symbol]) throw Object.assign(new Error('Market symbol is not listed on this venue.'), { status: 404 });
        return exchange.fetchTicker(symbol);
      });
      return { exchange: id, status: 'ok', observation: {
        exchange: id, symbol, last: ticker.last, bid: ticker.bid, ask: ticker.ask,
        baseVolume: ticker.baseVolume, quoteVolume: ticker.quoteVolume,
        percentage: ticker.percentage, timestamp: ticker.timestamp ? new Date(ticker.timestamp).toISOString() : null
      } };
    } catch (error) {
      return { exchange: id, status: 'error', error: error.message, httpStatus: error.status || 502 };
    }
  }));
  const observations = results.filter((item) => item.observation).map((item) => item.observation);
  const comparison = buildCrossVenueComparison(symbol, observations, Number(process.env.JPTI_CROSS_VENUE_OUTLIER_PERCENT) || 0.5);
  const payload = { ...comparison, results: results.map(({ exchange, status, error, httpStatus }) => ({ exchange, status, ...(error ? { error } : {}), ...(httpStatus ? { httpStatus } : {}) })),
    cache: 'miss', cacheTtlMs: 5000, note: 'Public exchange tickers only. No private keys or orders are used.' };
  crossVenueCache.set(cacheKey, { createdAt: Date.now(), payload });
  if (crossVenueCache.size > 200) crossVenueCache.delete(crossVenueCache.keys().next().value);
  res.json(payload);
});

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

if (process.env.JPTI_SERVE_WEB === 'true') {
  const webDist = resolve(process.env.JPTI_WEB_DIST || 'dist');
  app.use(express.static(webDist, { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/t-bots/')) return res.sendFile(resolve(webDist, 'index.html'));
    next();
  });
}

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: 'Invalid request', details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  }
  const status = Number.isInteger(error.status) ? error.status : 502;
  // Do not return request configs, headers, or raw exchange objects to clients.
  res.status(status).json({ error: error.message || 'Exchange gateway error', name: error.name || 'Error' });
});

await initializeStorage();
await initializeSchedulerLease();
const server = app.listen(port, host, () => {
  console.log(`JPTI API listening on http://${host}:${port}`);
  console.log(`Trading mode: ${process.env.JPTI_TRADING_MODE || 'paper'} | Live orders enabled: ${process.env.JPTI_ENABLE_LIVE_TRADING === 'true'}`);
  startOperationsScheduler();
});


let shutdownPromise;
export function shutdownJptiServer() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = new Promise((resolveClose, rejectClose) => {
    server.close(error => error ? rejectClose(error) : resolveClose());
  }).then(async () => {
    await stopOperationsScheduler();
    await closeSchedulerLease();
    await closeStorage();
  });
  return shutdownPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdownJptiServer().finally(() => process.exit(0)));
}
