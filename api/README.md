# JPTI Exchange Gateway

The gateway is a Node.js server-side integration layer built on CCXT. It provides real public exchange market data and private account reads for configured exchanges. It also contains a deliberately locked spot-order endpoint.

## Supported adapter catalog

The runtime catalog is generated dynamically from all exchange adapter IDs shipped in the installed CCXT version (100+ exchange APIs). JPTI reports the actual capabilities detected for each adapter. The market endpoint loads all active instruments exposed by the selected exchange and classifies spot, futures, perpetual swaps, margin-enabled spot, CFDs and options when the exchange metadata explicitly identifies them. Product availability, geographic restrictions, and metadata quality vary by provider; live order execution remains restricted to active spot markets with USDT quote currency in this initial gateway.

## Endpoints

- `GET /api/health` — gateway status and mode.
- `GET /api/exchanges` — supported exchange adapters and configured status.
- `GET /api/exchanges/:id/status` — credential presence (never returns secrets).
- `GET /api/exchanges/:id/markets?type=all&search=BTC` — active exchange market catalog with type filters (`spot`, `futures`, `perpetual`, `margin`, `cfd`, `options`), search, product counts, settlement/contract metadata, adapter capabilities and supported OHLCV timeframes.
- `GET /api/exchanges/:id/ticker/:symbol` — live ticker, e.g. `/api/exchanges/binance/ticker/BTC-USDT`.
- `GET /api/exchanges/:id/ohlcv/:symbol?timeframe=1h&limit=120` — live OHLCV candle history.
- `GET /api/exchanges/:id/balance` — private account balances; requires server-side credentials and the `x-jpti-api-token` header.
- `POST /api/exchanges/:id/orders` — locked live spot order endpoint.

Order JSON: `{"symbol":"BTC/USDT","side":"buy","type":"limit","amount":0.001,"price":60000}`.

## Run locally

1. Copy `.env.example` to `.env`.
2. Generate a long random value for `JPTI_API_TOKEN`.
3. Add API keys only for the exchanges you want to connect.
4. Use read-only keys for account visibility first. If later enabling orders, use trade permission only, disable withdrawals, and use IP restrictions where supported.
5. Run `npm install`, then `npm run dev:all`.
6. Open `http://localhost:5173`; gateway health is at `http://127.0.0.1:8787/api/health`.

## Live order lock

Live orders are rejected unless all of these are true:
- `JPTI_TRADING_MODE=live`
- `JPTI_ENABLE_LIVE_TRADING=true`
- The request contains a matching `x-jpti-api-token` header.
- The request contains `x-jpti-live-confirmation: I_ACKNOWLEDGE_LIVE_TRADING`.
- The market is active spot, quote currency is USDT, and the adapter supports order creation.
- The estimated order notional does not exceed `JPTI_MAX_ORDER_NOTIONAL_USDT` (default 100 USDT).

These checks are a starter policy gate, not a complete institutional risk engine. They do not replace account-level permissions, exchange-side limits, authentication, audit storage, monitoring, kill switches or independent security review. Keep this gateway bound to localhost during development. Do not expose it directly to the public internet. Cloud deployment requires TLS, strong user authentication, secret management, network controls, persistent audit records and a hardened execution service.

CCXT is a unified adapter, not a guarantee that every exchange exposes identical products or order parameters. Validate each exchange's API documentation and test with read-only credentials before enabling any trade permission.
