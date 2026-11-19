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


## Financial and on-chain intelligence

- `GET /api/intelligence/overview` — pulls CoinGecko global crypto market data and DeFiLlama chain TVL, stablecoin supply and protocol fees. Responses include provider status and fetch timestamps. Public providers can rate-limit or change availability.
- `GET /api/intelligence/macro/:seriesId?limit=120` — FRED observations. Configure `JPTI_FRED_API_KEY`. Example series include `FEDFUNDS`, `CPIAUCSL`, `UNRATE`, `DGS10` and `DTWEXBGS`. These are published observations with differing release lags, not streaming quotes.
- `GET /api/intelligence/onchain/evm/:chain/:address/transfers?limit=25` — indexed external, internal and ERC-20 transfers for Ethereum, Base, Polygon, Arbitrum and Optimism. Configure `JPTI_ALCHEMY_API_KEY`.
- `GET /api/intelligence/onchain/solana/:address/transactions?limit=25` — indexed Solana address transaction history. Configure `JPTI_HELIUS_API_KEY`.
- `POST /api/intelligence/score` — accepts optional `priceChangePct`, `volumeChangePct`, `netExchangeFlow`, `stablecoinSupplyChangePct` and `macroBias` (`risk-on`, `risk-off`, `neutral`). It returns the contribution from each supplied factor, a coarse directional bias and evidence-count confidence tier. It does not create or submit orders.

All provider keys belong in the server-side `.env`, never in browser code or Git. Wallet transaction history is subject to indexer coverage and query limits. A wallet address does not establish a person's identity or intent. Exchange inflow/outflow interpretation requires known exchange-labeled wallets and validated attribution; raw transfers must not be mislabeled as exchange flows. No provider result should be treated as a complete record of all chain activity.

This integration is a data foundation, not a complete institutional financial-data terminal. Live equity, bond, FX and commodity market feeds, earnings/fundamental datasets, a durable normalized time-series store, cross-provider entity resolution, validated strategy backtests, and production-grade wallet labeling remain future work.

- `GET /api/intelligence/market/:exchange/:symbol/context?timeframe=1h` — explainable multi-source pair context: closed OHLCV momentum and relative volume, 15m/1h/4h/1d trend alignment where supported, top-20 order-book notional imbalance, perpetual funding where supported, CoinGecko aggregate crypto risk context and DeFiLlama chain TVL leaders. Missing exchange capabilities are omitted rather than fabricated. A 30-second HTTP cache limits repeated broad-provider calls.


## Multi-provider financial data gateway (new integration layer)

JPTI exposes a provider registry at `GET /api/providers` and interval configuration at `GET /api/providers/intervals`. These routes report which credentials are present, the data categories available through adapters, documentation links and polling configuration. Credential presence is not a successful connection; each provider request must succeed to verify access and subscription entitlement.

Implemented read-oriented adapters:
- **Alpaca**: stock historical bars and paper-account read. Configure `JPTI_ALPACA_API_KEY` and `JPTI_ALPACA_API_SECRET`. Stock bars: `GET /api/providers/alpaca/bars?symbol=AAPL&timeframe=1Day&feed=iex&limit=100`. Crypto bars: `GET /api/providers/alpaca/crypto-bars?symbol=BTC/USD&timeframe=1Day&limit=100`. Private paper account: `GET /api/providers/alpaca/account` with `x-jpti-api-token`.
- **Quiver Quantitative**: congressional trading dataset adapter. Configure `JPTI_QUIVER_API_KEY`. `GET /api/providers/quiver/congress`. Dataset access and endpoint availability depend on current Quiver subscription/API terms; verify against your account documentation.
- **Finnhub**: `GET /api/providers/finnhub/quote/:symbol` and `GET /api/providers/finnhub/news?category=general|forex|crypto|merger`.
- **Alpha Vantage**: `GET /api/providers/alphavantage/quote/:symbol` and `GET /api/providers/alphavantage/news?tickers=AAPL&limit=50`. Rate limits and realtime/US exchange coverage depend on plan.
- **Twelve Data**: `GET /api/providers/twelvedata/time-series/:symbol?interval=1day&outputsize=100`. Asset coverage and credits depend on plan.
- **Infura**: `POST /api/providers/infura/:network/rpc` with a JSON body containing an allowlisted read-only JSON-RPC method and params. Supported network labels: mainnet, sepolia, arbitrum-mainnet, base-mainnet, optimism-mainnet, polygon-mainnet. Write methods are not exposed.
- **GDELT**: `GET /api/providers/news/search?q=central%20bank` for global news discovery without a key.
- **Liquid legacy exchange adapter**: `GET /api/providers/liquid/markets`. This is a compatibility probe only. The old Liquid/Quoine endpoint may be unavailable or the venue may not provide active trading services; do not assume liquidity or account execution support.
- Existing CoinGecko, DeFiLlama, FRED, Alchemy and Helius integrations remain available through the intelligence routes. Existing CCXT exchange adapters remain separate.

All API credentials are server-side only. Never use Vite `VITE_*` variables for secrets, commit credentials, or paste keys into chat. Start with read-only keys. Alpaca account read is pinned to its paper API host; this implementation does not submit Alpaca orders. Infura RPC methods are read-only allowlisted. The Liquid adapter is not wired to the live-order execution gateway.

### Operational intervals (seconds)

Set these values in the server `.env`:
- `JPTI_MM_INTERVAL_SECONDS=5` — market-maker quote-cycle target cadence (not an active order loop until a separately approved market-making worker is deployed).
- `JPTI_MARKET_MONITOR_INTERVAL_SECONDS=5` — market-monitor sampling cadence.
- `JPTI_MARKET_DATA_REFRESH_INTERVAL_SECONDS=5` — intended market-data refresh cadence.
- `JPTI_RECONCILE_INTERVAL_SECONDS=30` — portfolio/order/transaction reconciliation cadence target.
- `JPTI_INVESTOR_MONITOR_INTERVAL_SECONDS=60` — investor/watchlist monitoring cadence target.
- `JPTI_PROVIDER_HEALTH_INTERVAL_SECONDS=300` — provider health check cadence target.
- `JPTI_NEWS_REFRESH_INTERVAL_SECONDS=60` — news polling cadence target.
- `JPTI_ONCHAIN_REFRESH_INTERVAL_SECONDS=30` — on-chain refresh cadence target.
- `JPTI_SCHEDULER_ENABLED=true` — master scheduler policy flag.

Read effective validated values from `GET /api/providers/intervals`. Bounds are enforced in seconds to prevent zero/negative or extreme polling values. Important: this commit exposes the operational settings and provider adapters; it does not yet create durable investor-watchlist, portfolio reconciliation or market-making workers. Do not treat a displayed interval as proof that a worker is running. Reconciliation requires a persisted ledger and exchange order/fill history; investor monitoring requires configured investor/watchlists and licensed source data; market-making requires a separately risk-approved quoting engine. Those services remain future implementation stages.


## Operations scheduler, live monitor and durable transaction ledger

The futuristic command-center dashboard reads actual API health, provider registry, scheduler state, recent audit events and transaction-event counts. It deliberately does not invent balances, PnL, positions or strategy performance.

The API starts a server-side operations scheduler when the server starts (unless `JPTI_SCHEDULER_ENABLED=false`):
- Market monitor: samples live CCXT tickers for the server-side watchlist configured with `JPTI_MONITOR_MARKETS=binance:BTC/USDT,bitget:ETH/USDT`. It reports per-market errors and last successful snapshots.
- Provider registry monitor: checks credential/public-provider configuration. This is a configuration check, not a full authenticated connectivity test.
- Reconciliation, investor, market-making, news and on-chain jobs expose explicit prerequisite/disabled states. They do not fabricate activity or submit orders.
- Market ticker sampling and durable snapshot persistence are separate: snapshots default to a 60-second write cadence to limit local disk growth.

### Operational endpoints
- `GET /api/operations/overview` — scheduler uptime, job status, last-run timestamps, intervals and market snapshots.
- `GET /api/operations/events?limit=100` — recent persisted operational events (private ledger transaction details are excluded).
- `GET /api/operations/ledger/events?limit=100` — private transaction history; requires `x-jpti-api-token`.
- `GET /api/operations/ledger/summary` — transaction event counts by type; not a balance or PnL calculation.
- `POST /api/operations/ledger/events` — authenticated append-only transaction-event ingestion.

Transaction ingestion requires `x-jpti-api-token` matching the server-side `JPTI_API_TOKEN`. Example body:
```json
{
  "source": "alpaca",
  "eventType": "fill",
  "externalId": "provider-fill-id-123",
  "accountId": "paper-account-01",
  "symbol": "AAPL",
  "side": "buy",
  "quantity": 2,
  "price": 190.25,
  "fee": 0.01,
  "feeCurrency": "USD",
  "occurredAt": "2026-11-19T12:00:00.000Z"
}
```
The source/account/external-ID tuple is used for duplicate detection. The local JSONL event store is written under `JPTI_DATA_DIR` (default `data/`) and excluded from Git. Back it up and protect the host filesystem. This is an initial single-process local persistence implementation, not yet a multi-user database, distributed queue or institutional reconciliation ledger.

### Watchlist and interval configuration
```env
JPTI_SCHEDULER_ENABLED=true
JPTI_MONITOR_MARKETS=binance:BTC/USDT,bitget:ETH/USDT
JPTI_MM_INTERVAL_SECONDS=5
JPTI_MARKET_MONITOR_INTERVAL_SECONDS=5
JPTI_RECONCILE_INTERVAL_SECONDS=30
JPTI_INVESTOR_MONITOR_INTERVAL_SECONDS=60
JPTI_PROVIDER_HEALTH_INTERVAL_SECONDS=300
JPTI_MARKET_DATA_REFRESH_INTERVAL_SECONDS=5
JPTI_NEWS_REFRESH_INTERVAL_SECONDS=60
JPTI_ONCHAIN_REFRESH_INTERVAL_SECONDS=30
JPTI_MONITOR_PERSIST_INTERVAL_SECONDS=60
JPTI_DATA_DIR=data
```

MM interval is a target cadence only; the market-making worker remains disabled. Reconciliation and investor monitoring report waiting states until real account-fill ingestion and investor/watchlist sources are connected. Do not expose the local API directly to the internet; production deployment requires managed database storage, authentication, TLS, secret management, audit retention and operational monitoring.
