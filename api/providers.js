import express from 'express';

export const providerRouter = express.Router();

const now = () => new Date().toISOString();
const positiveSeconds = (key, fallback, min = 1, max = 86400) => {
  const value = Number(process.env[key]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};

export function getOperationalIntervals() {
  return {
    marketMonitorSeconds: positiveSeconds('JPTI_MM_INTERVAL_SECONDS', 5, 1, 3600),
    reconcileSeconds: positiveSeconds('JPTI_RECONCILE_INTERVAL_SECONDS', 30, 5, 86400),
    investorMonitorSeconds: positiveSeconds('JPTI_INVESTOR_MONITOR_INTERVAL_SECONDS', 60, 5, 86400),
    providerHealthSeconds: positiveSeconds('JPTI_PROVIDER_HEALTH_INTERVAL_SECONDS', 300, 30, 86400),
    marketDataRefreshSeconds: positiveSeconds('JPTI_MARKET_DATA_REFRESH_INTERVAL_SECONDS', 5, 1, 3600),
    newsRefreshSeconds: positiveSeconds('JPTI_NEWS_REFRESH_INTERVAL_SECONDS', 60, 10, 86400),
    onchainRefreshSeconds: positiveSeconds('JPTI_ONCHAIN_REFRESH_INTERVAL_SECONDS', 30, 5, 86400),
    schedulerEnabled: process.env.JPTI_SCHEDULER_ENABLED !== 'false'
  };
}

const providers = [
  { id: 'alpaca', name: 'Alpaca', category: 'broker-and-market-data', env: ['JPTI_ALPACA_API_KEY', 'JPTI_ALPACA_API_SECRET'], capabilities: ['US equities market data', 'crypto market data', 'account and positions', 'orders (separate protected execution path)'], docs: 'https://docs.alpaca.markets/' },
  { id: 'quiver', name: 'Quiver Quantitative', category: 'alternative-data', env: ['JPTI_QUIVER_API_KEY'], capabilities: ['Congressional trading', 'government contracts', 'lobbying and other alternative datasets subject to subscription'], docs: 'https://www.quiverquant.com/' },
  { id: 'finnhub', name: 'Finnhub', category: 'market-data-and-news', env: ['JPTI_FINNHUB_API_KEY'], capabilities: ['Equity quotes', 'company fundamentals', 'earnings and economic calendars', 'company and market news'], docs: 'https://finnhub.io/docs/api' },
  { id: 'alphavantage', name: 'Alpha Vantage', category: 'multi-asset-data', env: ['JPTI_ALPHAVANTAGE_API_KEY'], capabilities: ['Equities', 'FX', 'crypto', 'commodities', 'economic indicators', 'news sentiment', 'fundamentals'], docs: 'https://www.alphavantage.co/documentation/' },
  { id: 'twelvedata', name: 'Twelve Data', category: 'multi-asset-data', env: ['JPTI_TWELVEDATA_API_KEY'], capabilities: ['Stocks', 'ETFs', 'forex', 'crypto', 'commodities', 'fixed income reference data', 'technical indicators'], docs: 'https://twelvedata.com/docs' },
  { id: 'infura', name: 'Infura', category: 'blockchain-rpc', env: ['JPTI_INFURA_API_KEY'], capabilities: ['EVM JSON-RPC', 'block height', 'transaction and receipt lookup', 'logs and contract reads'], docs: 'https://docs.infura.io/' },
  { id: 'liquid', name: 'Liquid Exchange (legacy adapter)', category: 'exchange-adapter', env: ['JPTI_LIQUID_API_KEY', 'JPTI_LIQUID_API_SECRET'], capabilities: ['Legacy Liquid/Quoine REST market endpoints where still operational'], docs: 'https://developers.liquid.com/', caveat: 'Legacy service availability and API access must be verified; this adapter does not imply an active venue or supported account.' },
  { id: 'gdelt', name: 'GDELT Project', category: 'news', env: [], capabilities: ['Global news discovery and event monitoring'], docs: 'https://www.gdeltproject.org/' },
  { id: 'coingecko', name: 'CoinGecko', category: 'crypto-reference-data', env: [], capabilities: ['Global crypto market statistics and asset reference data'], docs: 'https://docs.coingecko.com/' },
  { id: 'defillama', name: 'DeFiLlama', category: 'defi-and-onchain', env: [], capabilities: ['Chain TVL', 'stablecoin supply', 'protocol fees and DeFi metrics'], docs: 'https://defillama.com/docs/api' },
  { id: 'fred', name: 'FRED', category: 'macro-data', env: ['JPTI_FRED_API_KEY'], capabilities: ['Macroeconomic and rates time series'], docs: 'https://fred.stlouisfed.org/docs/api/' },
  { id: 'alchemy', name: 'Alchemy', category: 'blockchain-indexer', env: ['JPTI_ALCHEMY_API_KEY'], capabilities: ['Indexed EVM transfers and enhanced blockchain data'], docs: 'https://www.alchemy.com/docs' },
  { id: 'helius', name: 'Helius', category: 'solana-indexer', env: ['JPTI_HELIUS_API_KEY'], capabilities: ['Solana enhanced transactions and webhooks'], docs: 'https://www.helius.dev/docs' }
];

export function providerDirectory() {
  return providers.map((item) => ({
    ...item,
    configured: item.env.length === 0 || item.env.every((key) => Boolean(process.env[key])),
    missingCredentials: item.env.filter((key) => !process.env[key]),
    status: item.env.length === 0 ? 'public-or-no-key' : item.env.every((key) => Boolean(process.env[key])) ? 'credentials-configured-not-verified' : 'not-configured'
  }));
}

async function requestJson(url, { headers = {}, method = 'GET', body, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method, body, signal: controller.signal,
      headers: { accept: 'application/json', ...headers }
    });
    const raw = await response.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { raw: raw.slice(0, 1000) }; }
    if (!response.ok) throw Object.assign(new Error(payload?.message || payload?.error || `Provider HTTP ${response.status}`), { status: response.status === 429 ? 429 : 502 });
    if (payload?.error && !payload?.data) throw Object.assign(new Error(payload.error.message || payload.error), { status: 502 });
    return payload;
  } finally { clearTimeout(timer); }
}
const requireKey = (key, provider) => {
  if (!process.env[key]) throw Object.assign(new Error(`${provider} API key is not configured. Set ${key} in the server .env file.`), { status: 503 });
  return process.env[key];
};
const safeSymbol = (value) => {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9._:/-]{1,32}$/.test(symbol)) throw Object.assign(new Error('Invalid symbol.'), { status: 400 });
  return symbol;
};

providerRouter.get('/providers', (_req, res) => {
  res.json({ generatedAt: now(), providers: providerDirectory(), intervals: getOperationalIntervals(), note: 'Configured means credentials are present only. A successful live request is required to verify connectivity and entitlement.' });
});
providerRouter.get('/providers/intervals', (_req, res) => res.json({ generatedAt: now(), intervals: getOperationalIntervals(), units: 'seconds', note: 'These are scheduler policy settings. A configured interval does not mean a market-making, reconciliation or investor-monitor worker is implemented or running.' }));

providerRouter.get('/providers/alpaca/bars', async (req, res) => {
  try {
    const key = requireKey('JPTI_ALPACA_API_KEY', 'Alpaca');
    const secret = requireKey('JPTI_ALPACA_API_SECRET', 'Alpaca');
    const symbol = safeSymbol(req.query.symbol || 'AAPL');
    const timeframe = String(req.query.timeframe || '1Day');
    if (!/^(1Min|5Min|15Min|30Min|1Hour|1Day)$/.test(timeframe)) return res.status(400).json({ error: 'Unsupported Alpaca timeframe.' });
    const limit = Math.min(1000, Math.max(1, Number.parseInt(req.query.limit || '100', 10) || 100));
    const feed = String(req.query.feed || 'iex');
    if (!['iex', 'sip', 'delayed_sip', 'boats', 'overnight'].includes(feed)) return res.status(400).json({ error: 'Unsupported Alpaca feed.' });
    const url = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars`);
    url.search = new URLSearchParams({ timeframe, limit: String(limit), feed }).toString();
    const data = await requestJson(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } });
    res.json({ provider: 'alpaca', symbol, timeframe, feed, bars: data.bars || [], nextPageToken: data.next_page_token || null, fetchedAt: now(), entitlementNote: 'Feed availability depends on the Alpaca account subscription.' });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});


providerRouter.get('/providers/alpaca/crypto-bars', async (req, res) => {
  try {
    const key = requireKey('JPTI_ALPACA_API_KEY', 'Alpaca');
    const secret = requireKey('JPTI_ALPACA_API_SECRET', 'Alpaca');
    const symbol = safeSymbol(req.query.symbol || 'BTC/USD');
    const timeframe = String(req.query.timeframe || '1Day');
    if (!/^(1Min|5Min|15Min|30Min|1Hour|1Day)$/.test(timeframe)) return res.status(400).json({ error: 'Unsupported Alpaca timeframe.' });
    const limit = Math.min(1000, Math.max(1, Number.parseInt(req.query.limit || '100', 10) || 100));
    const url = new URL(`https://data.alpaca.markets/v1beta3/crypto/us/bars`);
    url.search = new URLSearchParams({ symbols: symbol, timeframe, limit: String(limit) }).toString();
    const data = await requestJson(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } });
    res.json({ provider: 'alpaca', assetClass: 'crypto', symbol, timeframe, bars: data.bars?.[symbol] || [], fetchedAt: now() });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/alpaca/account', async (req, res) => {
  try {
    const expectedToken = process.env.JPTI_API_TOKEN;
    if (!expectedToken || req.get('x-jpti-api-token') !== expectedToken) return res.status(401).json({ error: 'Valid x-jpti-api-token required for private broker account data.' });
    const key = requireKey('JPTI_ALPACA_API_KEY', 'Alpaca');
    const secret = requireKey('JPTI_ALPACA_API_SECRET', 'Alpaca');
    const data = await requestJson('https://paper-api.alpaca.markets/v2/account', { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } });
    res.json({ provider: 'alpaca', account: data, fetchedAt: now(), environment: 'paper' });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/finnhub/quote/:symbol', async (req, res) => {
  try {
    const key = requireKey('JPTI_FINNHUB_API_KEY', 'Finnhub');
    const symbol = safeSymbol(req.params.symbol);
    const url = new URL('https://finnhub.io/api/v1/quote');
    url.search = new URLSearchParams({ symbol, token: key }).toString();
    const data = await requestJson(url);
    res.json({ provider: 'finnhub', symbol, quote: data, fetchedAt: now() });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/finnhub/news', async (req, res) => {
  try {
    const key = requireKey('JPTI_FINNHUB_API_KEY', 'Finnhub');
    const category = String(req.query.category || 'general');
    if (!['general', 'forex', 'crypto', 'merger'].includes(category)) return res.status(400).json({ error: 'Invalid Finnhub news category.' });
    const url = new URL('https://finnhub.io/api/v1/news');
    url.search = new URLSearchParams({ category, token: key }).toString();
    const news = await requestJson(url);
    res.json({ provider: 'finnhub', category, articles: Array.isArray(news) ? news : [], fetchedAt: now() });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/alphavantage/quote/:symbol', async (req, res) => {
  try {
    const key = requireKey('JPTI_ALPHAVANTAGE_API_KEY', 'Alpha Vantage');
    const symbol = safeSymbol(req.params.symbol);
    const url = new URL('https://www.alphavantage.co/query');
    url.search = new URLSearchParams({ function: 'GLOBAL_QUOTE', symbol, apikey: key }).toString();
    const data = await requestJson(url);
    if (data.Note || data.Information) return res.status(429).json({ error: data.Note || data.Information, provider: 'alphavantage' });
    res.json({ provider: 'alphavantage', symbol, quote: data['Global Quote'] || null, fetchedAt: now() });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/alphavantage/news', async (req, res) => {
  try {
    const key = requireKey('JPTI_ALPHAVANTAGE_API_KEY', 'Alpha Vantage');
    const url = new URL('https://www.alphavantage.co/query');
    url.search = new URLSearchParams({ function: 'NEWS_SENTIMENT', tickers: String(req.query.tickers || 'AAPL'), limit: String(Math.min(1000, Math.max(1, Number(req.query.limit) || 50))), apikey: key }).toString();
    const data = await requestJson(url);
    if (data.Note || data.Information) return res.status(429).json({ error: data.Note || data.Information, provider: 'alphavantage' });
    res.json({ provider: 'alphavantage', feed: data.feed || [], sentiment: data, fetchedAt: now() });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/twelvedata/time-series/:symbol', async (req, res) => {
  try {
    const key = requireKey('JPTI_TWELVEDATA_API_KEY', 'Twelve Data');
    const symbol = safeSymbol(req.params.symbol);
    const interval = String(req.query.interval || '1day');
    if (!/^(1min|5min|15min|30min|45min|1h|2h|4h|1day|1week|1month)$/.test(interval)) return res.status(400).json({ error: 'Unsupported Twelve Data interval.' });
    const url = new URL('https://api.twelvedata.com/time_series');
    url.search = new URLSearchParams({ symbol, interval, outputsize: String(Math.min(5000, Math.max(1, Number(req.query.outputsize) || 100))), apikey: key, format: 'JSON' }).toString();
    const data = await requestJson(url);
    if (data.status === 'error') return res.status(502).json({ error: data.message || 'Twelve Data request failed' });
    res.json({ provider: 'twelvedata', symbol, interval, values: data.values || [], meta: data.meta || {}, fetchedAt: now() });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/quiver/congress', async (req, res) => {
  try {
    const key = requireKey('JPTI_QUIVER_API_KEY', 'Quiver Quantitative');
    const url = new URL('https://api.quiverquant.com/beta/live/congresstrading');
    const data = await requestJson(url, { headers: { Authorization: `Token ${key}` } });
    res.json({ provider: 'quiver', dataset: 'congressional-trading', records: Array.isArray(data) ? data : data.data || [], fetchedAt: now(), note: 'Dataset access, historical depth and rate limits depend on Quiver subscription.' });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

const INFURA_NETWORKS = new Set(['mainnet', 'sepolia', 'arbitrum-mainnet', 'base-mainnet', 'optimism-mainnet', 'polygon-mainnet']);
const INFURA_METHODS = new Set(['eth_blockNumber', 'eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBalance']);
providerRouter.post('/providers/infura/:network/rpc', async (req, res) => {
  try {
    const key = requireKey('JPTI_INFURA_API_KEY', 'Infura');
    const network = String(req.params.network).toLowerCase();
    const method = String(req.body?.method || '');
    if (!INFURA_NETWORKS.has(network)) return res.status(400).json({ error: 'Unsupported Infura network.', supported: [...INFURA_NETWORKS] });
    if (!INFURA_METHODS.has(method)) return res.status(400).json({ error: 'RPC method is not in the read-only allowlist.', allowedMethods: [...INFURA_METHODS] });
    const params = Array.isArray(req.body?.params) ? req.body.params : [];
    if (params.length > 3) return res.status(400).json({ error: 'Too many RPC parameters.' });
    const data = await requestJson(`https://${network}.infura.io/v3/${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (data.error) return res.status(502).json({ error: data.error.message || 'Infura RPC error', code: data.error.code });
    res.json({ provider: 'infura', network, method, result: data.result, fetchedAt: now() });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/news/search', async (req, res) => {
  try {
    const query = String(req.query.q || 'financial markets').trim().slice(0, 120);
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.search = new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '50', sort: 'HybridRel' }).toString();
    const data = await requestJson(url);
    res.json({ provider: 'gdelt', query, articles: data.articles || [], fetchedAt: now(), note: 'News discovery only; validate source credibility, publication time and duplicate syndication before using as a signal.' });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

providerRouter.get('/providers/liquid/markets', async (_req, res) => {
  try {
    const base = String(process.env.JPTI_LIQUID_API_BASE_URL || 'https://api.liquid.com').replace(/\/$/, '');
    const data = await requestJson(`${base}/products`);
    res.json({ provider: 'liquid', markets: Array.isArray(data) ? data : [], fetchedAt: now(), caveat: 'Legacy Liquid/Quoine API reachability does not establish current exchange operations, liquidity or account support.' });
  } catch (e) { res.status(e.status || 502).json({ error: `Liquid legacy endpoint unavailable or unsupported: ${e.message}` }); }
});
