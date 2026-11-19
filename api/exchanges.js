import ccxt from 'ccxt';

export const SUPPORTED_EXCHANGES = [
  'binance', 'bybit', 'okx', 'kucoin', 'kraken', 'coinbase',
  'bitget', 'gateio', 'mexc', 'htx', 'bitfinex', 'gemini',
  'bitstamp', 'cryptocom', 'phemex', 'bingx', 'bitmart',
  'poloniex', 'bitrue', 'whitebit'
].filter((id) => ccxt.exchanges.includes(id));

const envKey = (id, suffix) => `JPTI_${id.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_${suffix}`;

export function exchangeConnectionStatus(id) {
  if (!SUPPORTED_EXCHANGES.includes(id)) return { supported: false, configured: false };
  return {
    supported: true,
    configured: Boolean(process.env[envKey(id, 'API_KEY')] && process.env[envKey(id, 'API_SECRET')]),
    hasPassword: Boolean(process.env[envKey(id, 'PASSWORD')])
  };
}

export function createExchange(id, { privateAccess = false } = {}) {
  if (!SUPPORTED_EXCHANGES.includes(id)) {
    throw Object.assign(new Error('Exchange is not in the supported exchange catalog.'), { status: 404 });
  }
  const ExchangeClass = ccxt[id];
  if (!ExchangeClass) throw Object.assign(new Error('Exchange adapter is unavailable in this CCXT build.'), { status: 503 });

  const config = {
    enableRateLimit: true,
    timeout: Number(process.env.JPTI_EXCHANGE_TIMEOUT_MS || 15000),
    options: { defaultType: 'spot' }
  };
  if (privateAccess) {
    const apiKey = process.env[envKey(id, 'API_KEY')];
    const secret = process.env[envKey(id, 'API_SECRET')];
    if (!apiKey || !secret) {
      throw Object.assign(new Error(`Server-side API credentials are not configured for ${id}.`), { status: 409 });
    }
    config.apiKey = apiKey;
    config.secret = secret;
    const password = process.env[envKey(id, 'PASSWORD')];
    if (password) config.password = password;
    const uid = process.env[envKey(id, 'UID')];
    if (uid) config.uid = uid;
  }
  return new ExchangeClass(config);
}

export async function withExchange(id, options, operation) {
  const exchange = createExchange(id, options);
  try {
    await exchange.loadMarkets();
    return await operation(exchange);
  } finally {
    if (typeof exchange.close === 'function') {
      try { await exchange.close(); } catch { /* REST adapters may not need closing. */ }
    }
  }
}

export function listExchangeCatalog() {
  return SUPPORTED_EXCHANGES.map((id) => ({
    id,
    name: ccxt[id].name || id,
    configured: exchangeConnectionStatus(id).configured,
    capabilities: {
      ticker: Boolean(ccxt[id].has?.fetchTicker),
      orderBook: Boolean(ccxt[id].has?.fetchOrderBook),
      ohlcv: Boolean(ccxt[id].has?.fetchOHLCV),
      balance: Boolean(ccxt[id].has?.fetchBalance),
      createOrder: Boolean(ccxt[id].has?.createOrder)
    }
  }));
}
