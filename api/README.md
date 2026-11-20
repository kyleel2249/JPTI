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
- **Alpaca**: stock historical bars, crypto bars, paper-account read and paper-account activity history. Configure `JPTI_ALPACA_API_KEY` and `JPTI_ALPACA_API_SECRET`. Stock bars: `GET /api/providers/alpaca/bars?symbol=AAPL&timeframe=1Day&feed=iex&limit=100`. Crypto bars: `GET /api/providers/alpaca/crypto-bars?symbol=BTC/USD&timeframe=1Day&limit=100`. Private paper account: `GET /api/providers/alpaca/account` with `x-jpti-api-token`. Private activity history: `GET /api/providers/alpaca/activities?activity_type=FILL&limit=50` with the same token. Account and activity reads are pinned to paper API; they do not place orders.
- **Quiver Quantitative**: congressional trade history for a requested US ticker. Configure `JPTI_QUIVER_API_KEY`. `GET /api/providers/quiver/congress/NVDA`. The adapter uses the documented historical congressional-trading endpoint and Bearer authentication. Dataset access depends on subscription; Quiver's public pricing currently lists Hobbyist from $30/month and Trader from $75/month, with commercial rights reserved for eligible Startup/Enterprise plans.
- **Finnhub**: `GET /api/providers/finnhub/quote/:symbol`, `GET /api/providers/finnhub/candles/:symbol?resolution=D&from=UNIX_SECONDS`, and `GET /api/providers/finnhub/news?category=general|forex|crypto|merger`.
- **Alpha Vantage**: `GET /api/providers/alphavantage/quote/:symbol`, `GET /api/providers/alphavantage/daily/:symbol?outputsize=compact|full`, and `GET /api/providers/alphavantage/news?tickers=AAPL&limit=50`. The free service currently documents 25 requests/day for most datasets; realtime and 15-minute delayed US equity data are premium/licensed.
- **Twelve Data**: `GET /api/providers/twelvedata/quote/:symbol` and `GET /api/providers/twelvedata/time-series/:symbol?interval=1day&outputsize=100`. The current Basic tier documents 8 API credits/minute and 800/day; websocket entitlements and market coverage depend on plan.
- **Infura**: `POST /api/providers/infura/:network/rpc` with a JSON body containing an allowlisted read-only JSON-RPC method and params. Supported network labels: mainnet, sepolia, arbitrum-mainnet, base-mainnet, optimism-mainnet, polygon-mainnet. Write methods are not exposed. Infura is blockchain RPC infrastructure, not a market-price feed.
- **GDELT**: `GET /api/providers/news/search?q=central%20bank` for global news discovery without a key.
- **Liquid legacy exchange adapter**: `GET /api/providers/liquid/markets`. This is a compatibility probe only. The old Liquid/Quoine endpoint may be unavailable or the venue may not provide active trading services; do not assume liquidity or account execution support. It is not included in JPTI's active trading venue list.
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

Read effective validated values from `GET /api/providers/intervals`. Bounds are enforced in seconds to prevent zero/negative or extreme polling values. Important: the scheduler now includes real market monitoring and optional private fill-history polling when JPTI_FILL_SYNC_MARKETS is configured. Portfolio accounting and current balance snapshots are available from the authenticated advanced endpoint, but a fully automated balance reconciliation still requires verified opening balances and complete external cash-flow history. Investor monitoring and market-making remain prerequisite-gated; a displayed interval is not proof that those workers are active.


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


Provider limitations: Finnhub, Alpha Vantage and Twelve Data have symbol coverage, market-hours, exchange licensing, per-minute quota and plan restrictions. Do not merge quotes without preserving provider timestamp, venue, currency and entitlement metadata. Quiver datasets are primarily US-company alternative data and may update after public filings/disclosures; they are not tick-level signals. Twelve Data websocket access requires eligible plans; the current Basic/Grow trial is restricted. Alpaca's Basic equities feed is IEX rather than consolidated all-venue coverage; paid market-data tiers change that coverage. Validate account eligibility and local regulatory/tax requirements before using any broker account from Ghana.


## Advanced cross-provider quote intelligence

- `GET /api/providers/consensus/quote/:symbol` queries only configured quote providers (Finnhub, Twelve Data, Alpaca, and optionally Alpha Vantage) and normalizes their observations into a common response.
- The response preserves each provider's timestamp, currency, venue, raw provider status and price. It calculates a median cross-source reference only when currency metadata does not conflict.
- With at least three observations, sources whose price differs from the median by more than `JPTI_QUOTE_OUTLIER_THRESHOLD_PERCENT` are flagged for manual review. Stale observations are marked using `JPTI_QUOTE_STALE_AFTER_SECONDS`.
- The endpoint caches each symbol for `JPTI_QUOTE_CACHE_TTL_MS` (default 30 seconds) and enforces provider-specific minimum request spacing to reduce quota exhaustion. Alpha Vantage is excluded from consensus by default; set `JPTI_ENABLE_ALPHAVANTAGE_CONSENSUS=true` only if your plan and quota support it.
- The Overview dashboard includes a read-only cross-source quote panel. It does not submit orders and does not claim to provide a consolidated NBBO or guaranteed executable price.

A cross-provider median is only a sanity check: feeds may differ by venue, session, delay, currency, corporate-action adjustment and licensing entitlement. A flagged outlier is not proof that a provider is wrong. Review source timestamps and market status before relying on the result.


## Cross-exchange spread scanner

- `GET /api/exchanges/compare/ticker?symbol=BTC%2FUSDT&exchanges=binance,bitget,bybit,okx` requests public tickers from up to six supported CCXT venues.
- Returns per-venue last/bid/ask/volume/timestamp, median last price, last-price dispersion and an indicative best-ask/best-bid gross edge when two different venues provide valid top-of-book quotes.
- A five-second per-symbol/venue-set cache limits repeated calls. Failed or unlisted markets remain visible in the per-venue result list.
- The scanner is read-only and does not submit arbitrage orders. Gross edge excludes trading fees, funding, market depth, slippage, latency, withdrawal/deposit delays, counterparty risk and venue restrictions. Do not interpret a positive edge as executable profit.


## Advanced forecasting and institutional intelligence

These read-oriented endpoints are mounted under \`/api/advanced\`:

- \`GET /advanced/forecast/:exchange/:symbol?timeframe=1h&limit=500\` — rolling statistical 24-hour and 1/4/12-hour range forecasts from exchange OHLCV. Returns expected midpoint, high/low envelopes, ATR, volatility, momentum and conservative/base/aggressive scenarios. The baseline uses historical log-return volatility and ATR; it is not an ML-trained model and its nominal interval is not calibrated probability until walk-forward validation is performed.
- \`GET /advanced/orderbook/:exchange/:symbol?limit=50\` — visible bid/ask notional depth, imbalance, spread and large displayed liquidity levels. Consecutive snapshots are compared in process memory. A large order is not proof of spoofing; reliable spoofing detection requires order-level add/cancel/replace feeds and venue surveillance.
- \`GET /advanced/derivatives/:exchange/:symbol\` — funding rate, open interest and ticker/index basis where CCXT and the venue expose them. Liquidation clusters explicitly report unavailable until a venue-specific liquidation stream/history is integrated.
- \`POST /advanced/council\` — deterministic specialist evidence agents for trend, volume, microstructure, derivatives and risk. Returns evidence, disagreement and conservative confidence; these are not autonomous LLM traders.
- \`POST /advanced/backtest/ema\` — simple EMA long/flat research baseline with configurable periods and fee assumption. It is not a complete strategy laboratory.
- \`POST /advanced/monte-carlo\` — seeded bootstrap scenarios from supplied returns. This is a distributional stress tool, not a return guarantee.
- \`POST /advanced/portfolio/reconcile\` — authenticated balance-versus-fill arithmetic check. Requires \`x-jpti-api-token\` and supplied balances/fills; it does not yet automatically ingest every exchange fill, account for opening inventory/transfers/fee currencies, or calculate realized/unrealized PnL.
- \`POST /advanced/execution/estimate\` — walks a supplied order book to estimate average fill, visible depth shortfall, fees and slippage. It is indicative and does not route orders.

### Institutional implementation boundaries

The current implementation now includes rolling walk-forward validation for an EMA baseline, configurable scheduled exchange trade-history polling, authenticated weighted-average cost-basis accounting, ledger cash-flow movements, current private balance snapshots, and a server-sent event stream that polls exchange order-book and supported derivatives endpoints. The stream is polling-based, not a native exchange WebSocket. It does not claim calibrated forecast probabilities, trained ML models, proven spoofing identification, complete liquidation maps across venues, broad multi-strategy parameter optimization, institutional-grade database durability, full tax-lot/corporate-action accounting, autonomous AI agents, or live smart-order routing. Those require additional venue coverage, durable storage, market-impact/funding models, and independent validation. Walk-forward results remain a research baseline, not evidence of future profitability.

Public market-data routes are read-only. Authenticated fill synchronization and ledger ingestion append normalized records to the local journal; portfolio accounting reads that journal and current exchange balances. Existing live-order controls remain separate and disabled by default. Keep API credentials server-side.


## Walk-forward research, automatic fill ingestion and portfolio accounting

The advanced laboratory is exposed through `api/advanced-lab.js`:

- `GET /api/advanced/lab/walk-forward/:exchange/:symbol?timeframe=1h&limit=1000&trainBars=300&testBars=100&stepBars=100&feeBps=10` — retrieves historical OHLCV server-side and runs rolling walk-forward EMA research. The `POST /api/advanced/lab/walk-forward` variant accepts supplied candles for research/import workflows. Choose `strategy=ema`, `strategy=rsi` or `strategy=donchian`. The parameter grid is optimized independently inside each training window; each fold then evaluates the selected parameters on a later out-of-sample window. The response separates fold-level training and OOS results and aggregates OOS returns. This is a research baseline, not proof of future profitability.
- `POST /api/advanced/fills/sync/:exchange` — authenticated, read-only on-demand import of private exchange trade history using CCXT `fetchMyTrades`. Requires `x-jpti-api-token`; optional body: `{"symbol":"BTC/USDT","since":1795000000000}`. Trades are normalized into the existing append-only ledger and deduplicated by exchange/account/trade ID. Venue history limits and pagination vary; use time cursors to backfill older records.
- The operations scheduler also runs automatic private fill polling when `JPTI_FILL_SYNC_MARKETS=binance:BTC/USDT,bitget:ETH/USDT` is configured. It uses read-only trade-history access, a rolling in-memory cursor and ledger idempotency. On restart it rechecks the prior 24 hours, relying on deduplication. Monitor the `fill-ingestion` job in `GET /api/operations/overview`; a configured key is not proof that the exchange granted the required permission.
- `GET /api/advanced/portfolio/accounting` — authenticated weighted-average cost-basis accounting from ingested fills, segregated by exchange/account/symbol. It reports realized PnL in each quote currency, remaining position quantity/cost basis, fee totals and unrealized PnL only when a current mark is available from the originating exchange. It is not FIFO or a tax statement. Deposits, withdrawals, transfers, funding, borrow interest, rebates and FX translation are not yet fully journaled.
- `GET /api/advanced/stream/:exchange/:symbol?intervalMs=2000` — Server-Sent Events stream for live order-book, ticker and supported funding/open-interest snapshots. It polls the exchange through CCXT and emits `intelligence` events; it is not a native venue WebSocket subscription. Disconnect the client to stop polling. Sampling is bounded to 1–15 seconds.

Example walk-forward body:
```json
{
  "candles": [[1795000000000, 100, 102, 99, 101, 1200]],
  "trainBars": 500,
  "testBars": 100,
  "stepBars": 100,
  "fastPeriods": [5, 9, 12],
  "slowPeriods": [21, 30, 50],
  "feeBps": 10
}
```

Private exchange keys must be configured server-side with trade-history read permission only where possible; withdrawal permissions should remain disabled. Do not expose the API publicly without TLS, strong authentication, durable database storage, audit controls and rate limiting. The current ledger remains a single-process local JSONL store. Walk-forward output supports EMA crossover, RSI mean-reversion and Donchian breakout long/flat research baselines; spread, slippage, funding, borrow, market impact, partial fills, taxes and venue-specific execution constraints are not included in its returns. Portfolio VaR and stress calculations are historical/parallel-shock estimates, not maximum-loss guarantees; derivatives Greeks, leverage, liquidation, cross-currency FX and correlated liquidity shocks are not modeled.


The ledger schema also accepts `funding`, `interest`, `borrow` and `rebate` event types. For signed cash flows, provide `currency`, `quantity` and `metadata.signedAmount` (positive for a credit, negative for a debit). A `transfer` event should include `metadata.fromCurrency`, `metadata.fromAmount`, `metadata.toCurrency` and `metadata.toAmount`. The accounting response exposes net movements by exchange/account/currency; these are not absolute balances unless a verified opening balance and complete history are supplied. Sells exceeding the known inventory are flagged as unmatched rather than assigned an invented cost basis.


### Portfolio risk diagnostics extension

The authenticated `GET /api/advanced/portfolio/risk` response now includes additional historical diagnostics for each quote-currency portfolio:
- Annualized realized historical volatility, using daily observations and 365 crypto-market days.
- Annualized Sharpe ratio with an explicitly assumed zero risk-free rate, and annualized Sortino ratio using downside deviation.
- Maximum drawdown of the reconstructed historical weighted portfolio equity curve.
- Best and worst observed portfolio days, plus the worst rolling 20-observation compounded return.
- A coverage warning when fewer than 20 aligned observations are available.

These statistics use current-notional weights and aligned daily close-to-close returns from the available exchange candles. They are backward-looking estimates; the zero-rate Sharpe, 365-day annualization, survivorship/coverage limitations, missing histories, and lack of FX conversion can materially affect interpretation. They do not model leverage, derivatives liquidation, intraday gaps, funding, fees or liquidity shocks. They are not forecasts or a guarantee of maximum loss.


## T-Bots integration and shared intelligence bridge

The original T-Bots application is preserved under `integrations/t-bots/` and served at `/t-bots/`. It retains the six cooperating agents and all original strategy/risk configuration. T-Bots' original executor is a simulator; its live DEX feed never sends wallet transactions.

Authenticated bridge routes (use `x-jpti-api-token`):
- `GET /api/integrations/tbots/status` — integration mode and safety boundary.
- `GET /api/integrations/tbots/context?exchange=binance&symbol=BTC%2FUSDT` — JPTI market-regime context from hourly candles, top-10 order-book imbalance and funding where supported.
- `POST /api/integrations/tbots/events` — idempotent bot telemetry append into the shared JPTI ledger. Supported event types: `bot_signal`, `bot_decision`, `bot_trade`, `bot_filter`, `bot_session`. Use a stable `externalId`.
- `GET /api/integrations/tbots/memory?limit=50` — recent T-Bots events from the shared ledger.

The embedded browser client publishes paper entries/exits, closed-trade summaries, filters and system decisions. It periodically reads JPTI BTC market context. A fresh `risk_off` score below 35 blocks new T-Bots entries only; the existing exit manager continues to operate. This is a coarse cross-market risk gate, not token-level analysis. Risk context uses a simple heuristic and should be treated as a conservative advisory filter, not a predictive model. Memory is a shared event journal, not an LLM memory or shared mutable strategy state.

Run the T-Bots terminal at `http://localhost:8787/t-bots/` while the JPTI API is running. Paste the local `JPTI_API_TOKEN` into the T-Bots compose screen to connect. Do not expose this token in a public deployment or commit it. The integration remains paper-only; no Solana wallet signing or swap execution is implemented.


## T-Bots unified multi-asset integration

T-Bots is embedded at `/t-bots/` and remains a six-agent paper engine. Its live discovery feed now consumes DexScreener latest token profiles across chain IDs, groups candidates by chain, and loads chain-specific pair data. Solana security enrichment uses RugCheck; selected EVM chains use GoPlus token-security data. Unknown chains and incomplete security results fail closed in the Rug Check agent.

Supported GoPlus mappings in this integration: Ethereum, BNB Chain, Polygon, Arbitrum, Optimism, Base, Avalanche, Linea and Blast. Solana uses RugCheck. The discovery feed is based on a provider's latest token-profile feed, not every token pair on every chain. Security provider coverage differs by chain, and missing LP-lock duration or holder data cannot be treated as a pass.

Authenticated endpoints:
- `GET /api/integrations/tbots/universe?q=token-or-project` — search multi-chain DEX pairs with a heuristic evidence score.
- `GET /api/integrations/tbots/risk` — closed paper-trade memory, recent loss streak and shared new-entry gate.
- `GET /api/integrations/tbots/memory?limit=50` — recent shared ledger events.
- `GET /api/integrations/tbots/context?exchange=binance&symbol=BTC%2FUSDT` — selected CEX benchmark context.

The shared risk gate pauses new T-Bots entries after three consecutive losing closed paper trades. If its state cannot be retrieved, new entries are blocked; existing positions continue through their normal exit logic. This is not a fully consolidated JPTI + T-Bots portfolio equity calculation. DEX execution remains simulated; no wallet signing or live swap execution is implemented.


## Universal cross-asset engine

Routes are mounted under `/api/universal`:
- `GET /profiles` — strategy profiles and asset-class coverage.

- `GET /api/universal/coverage` — public configuration/catalog coverage matrix for asset classes and providers. Reports configured sources, supported CCXT venue counts and configured watchlist sizes; it does not run provider health checks or guarantee a symbol is entitled/live.
- `POST /strategy/evaluate` — evidence-based deterministic profile evaluation.
- `GET /market/:exchange/:symbol?timeframe=1h` — public CEX ticker, OHLCV, 15m/1h/4h/1d trend alignment where supported, RSI, visible book depth, funding/open interest where supported and deterministic evidence council.
- `GET /cex-watchlist` — private-token authenticated read-only active spot watchlist configured with `JPTI_TBOTS_CEX_MARKETS`.
- `POST /asset-evidence` — private-token authenticated batch per-asset heuristic evidence score. This is not a safety check.
- `GET /asset/:chain/:address` — private-token authenticated DEX pair plus RugCheck (Solana) or GoPlus (selected EVM) security observations. Security output is review-required/fail-closed, not an approval.
- `GET /dex/search?q=...` — private-token authenticated multi-chain pair search.
- `GET /dex-watchlist` — private-token authenticated configured chain:contract watchlist for established DEX assets.
- `GET /macro` — CoinGecko global crypto metrics, DeFiLlama chain TVL, and FRED FEDFUNDS when configured.
- `GET /news?q=...` — GDELT article discovery.
- `GET /risk` — private-token authenticated shared entry gate and realized loss state.
- `GET /performance` — private-token authenticated paper-trade and exchange-fill attribution.

T-Bots can merge its multi-chain DEX feed with a configured CEX spot watchlist. Example server-side settings:

```env
JPTI_TBOTS_DEX_WATCHLIST=solana:YourSolanaMint,base:0xYourTokenContract
JPTI_TBOTS_CEX_MARKETS=binance:BTC/USDT,binance:ETH/USDT,binance:SOL/USDT,bitget:BTC/USDT
JPTI_TBOTS_MAX_CONSECUTIVE_LOSSES=3
JPTI_TBOTS_DAILY_LOSS_LIMIT_USD=100
```

The CEX watchlist is limited to active USD/stablecoin-quoted spot markets and checks 24h quote volume, visible order-book depth and spread before T-Bots can consider a paper entry. The optional DEX watchlist accepts up to 60 chain:contract entries and resolves the most liquid provider pair for each address. No private exchange credentials are required for this read-only feed.

Unified realized PnL is computed from recorded exchange fills with weighted-average cost and reported per quote currency. USD, USDT, USDC, DAI and FDUSD are treated as approximate USD equivalents for the daily loss guard; other currencies are not FX-converted. T-Bots paper PnL is separately denominated in USD. This is not full account equity reconciliation: unrealized positions, complete cashflows, transfers, funding, borrow, third-token fees and missing opening inventory remain limitations.


- `POST /universal/control` — private-token authenticated persisted pause/resume of T-Bots new entries. JSON body: `{"action":"pause_new_entries","reason":"operator request"}` or `{"action":"resume_new_entries"}`. Existing positions keep their normal exit handling; this is not a force-close or exchange cancellation command.
