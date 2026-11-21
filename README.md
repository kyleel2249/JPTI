# JOPEARL TRADING INTELLIGENCE (JPTI)

JPTI is an extensible trading-intelligence workspace with a React/Vite interface and a server-side Node.js exchange gateway. The gateway uses CCXT adapters to connect to multiple live exchanges through a unified API.

## Implementation status

**Implemented in this build**
- Selectable local JSONL or PostgreSQL event storage; PostgreSQL mode uses JSONB event records, database-enforced ledger idempotency, durable per-market exchange fill-sync cursors and startup schema initialization. Local-file mode remains the default for development.
- Responsive React dashboard for desktop and mobile browsers.
- Node.js API gateway with live public ticker and market-catalog endpoints.
- Multi-exchange CCXT adapter catalog (availability is detected from the installed CCXT version).
- Server-side private account-balance endpoint for exchanges with configured credentials.
- Locked live spot-order endpoint with explicit environment flags, API-token confirmation, active-market checks, USDT quote restriction and per-order notional cap.
- Exchange selector with dynamic, searchable market discovery across spot, futures, perpetual swaps, margin-enabled instruments, CFDs and options where the selected exchange exposes those products.
- Market type filters, per-exchange product counts and adapter capability metadata; the catalog refreshes every five minutes to discover newly listed and delisted instruments.
- Advanced chart tools: VWAP overlay, Stoch RSI, OBV, price trend bias, horizontal support/resistance levels and two-click trend lines.
- Live OHLCV candlestick chart with selectable exchange-supported timeframes (1m through 1M where supported), zoom controls, fit-to-view and crosshair OHLCV inspection. Candle density/spacing, candle-body width and volume-column height are independently adjustable with sliders and reset controls.
- Optional EMA 20, EMA 50 and Bollinger Band overlays; RSI(14), ATR(14), MACD histogram and volume analytics.

- Financial intelligence workspace: CoinGecko global crypto market statistics; DeFiLlama chain TVL, stablecoin supply and protocol-fee leaders; FRED macroeconomic observations when a server-side API key is configured.
- Address-level blockchain history lookups: Alchemy indexed EVM asset transfers (Ethereum, Base, Polygon, Arbitrum and Optimism) and Helius enhanced Solana transactions when provider keys are configured.
- Explainable market-context scoring endpoint that combines closed-candle momentum, relative volume, multi-timeframe alignment (15m/1h/4h/1d where supported), top-20 order-book depth imbalance, perpetual funding when available, CoinGecko aggregate crypto risk context and DeFiLlama chain TVL context. Each factor contribution, source status, timestamp and limitations are exposed; the score is a research heuristic, not an autonomous trading instruction.
- Smart Money Concepts (SMC) analysis calculated from closed OHLCV candles: three-candle Fair Value Gaps, confirmed swing-high/low liquidity sweeps, close-confirmed BOS/CHoCH structure breaks, and heuristic last-opposing-candle order-block zones.
- Independent visibility controls for FVG, liquidity sweeps, BOS/CHoCH and order blocks, configurable swing sensitivity (2/3/5/8 bars), chart overlays and an SMC event summary.

**Phase 9 — Institutional terminal and operator experience**
- Dedicated institutional command terminal with a safe allowlisted command parser (`HELP`, `STATUS`, `REFRESH`, `OPEN`, `SYMBOL`, `WATCH`, `UNWATCH`, `RISK`); no shell, arbitrary code execution or direct order command is exposed.
- Multi-venue public ticker watchlist across Binance, Bitget, Bybit and OKX, with local non-sensitive watchlist persistence, source/dispersion context and explicit indicative-data caveats.
- Live service telemetry, paper-mode status, quick workspace routing and authenticated ledger-backed portfolio risk snapshot in one responsive terminal.
- Institutional visual system: layered navy surfaces, restrained blue/cyan/emerald/violet/amber status colors, refined typography, responsive operator panels and reduced-motion support.

**Phase 8 — Unified strategy intelligence and T-Bots paper-entry controls**
- Authenticated strategy scorecards by strategy profile, calculated from persisted T-Bots paper-closed events only, including expectancy, win rate, profit factor, drawdown, sample-size quality, and venue/asset-class breakdowns.
- Authenticated paper-entry preflight combining required strategy evidence, server-enforced evidence freshness, persisted global pause state, consecutive-loss limits, daily realized-loss guard and token-security status.
- T-Bots calls the shared JPTI preflight after its own rug check and before sizing/entry when the authenticated bridge is configured. Failed or unavailable preflight blocks new paper entries; open positions retain their exit logic.
- New configuration: `JPTI_TBOTS_PREFLIGHT_MAX_EVIDENCE_AGE_SECONDS=90`. See `docs/PHASE_8_STRATEGY_INTELLIGENCE.md`.

**Not yet implemented / not to be mistaken for complete functionality**
- PostgreSQL-backed persistence requires `JPTI_STORAGE_BACKEND=postgres`, a reachable `DATABASE_URL`, and the documented TLS settings. Local JSONL mode is intended for single-process development; scheduler leader election and multi-instance coordination are not yet implemented.
- The main candlestick chart and top market strip use live OHLCV/ticker data from the selected exchange. Product availability and market classification are exchange-specific; an instrument is only shown when its adapter reports it in the public catalog. Portfolio balances, PnL, scanner, autonomous-agent status and watchlist sample values remain illustrative until their services are implemented.
- SMC markings are rule-based technical interpretations, not proof of institutional activity. Order blocks are candidate zones, and all signals require trader validation. Multi-timeframe confluence, advanced alerts and SMC-based strategy backtesting are not yet implemented. FVGs are marked filled after a full traversal of the gap, and order-block zones are marked invalidated after a close through the far boundary.
- Financial and on-chain coverage is provider-dependent: CoinGecko/DeFiLlama endpoints are public and may rate-limit; FRED, Alchemy and Helius require user-created server-side API keys. Wallet history is indexed/provider-limited, not a complete chain archive, and wallet ownership/intent is not inferred. The confluence scoring endpoint is not yet a validated backtested strategy or an order trigger; on-chain wallet histories are currently available through separate read-only address lookups and are not automatically attributed to exchange netflows or fed into pair scores. Equities, bonds, FX and commodity feeds are not yet connected as live tradable market feeds; FRED provides selected macroeconomic time series only.
- No persistent user accounts, encrypted credential vault, Redis cache/queue, authenticated multi-user cloud gateway, production WebSocket streaming, full futures/margin execution, copy-trading engine, fully automated strategy execution engine, AI model inference, institution-grade portfolio accounting or native Android APK yet. PostgreSQL durable event storage and scheduler leases are implemented when configured.
- A configured exchange key does not mean an exchange account has been authenticated until a private endpoint succeeds.
- No exchange is connected until you configure your own credentials and verify the connection.

## Requirements

- Node.js 22 LTS (npm included)
- Git
- Internet access to download packages and reach exchange APIs

## Windows installation

Open Command Prompt:

```bat
cd /d C:\Users\HP\Desktop
git clone https://github.com/kyleel2249/JPTI.git
cd JPTI
npm install
copy .env.example .env
notepad .env
```

In `.env`, keep paper mode enabled initially. Add credentials for only the exchanges you intend to connect. Then start both the frontend and API:

```bat
npm run dev:all
```

Open the Vite URL, normally http://localhost:5173. The API health endpoint is http://127.0.0.1:8787/api/health.

For a frontend-only session use `npm run dev`. For the API only use `npm run dev:api`. Validate server syntax with `npm run check` and build the frontend with `npm run build`.

## Multi-exchange configuration

JPTI currently uses CCXT adapters for supported exchanges from this catalog (the exact list is returned by `GET /api/exchanges`): Binance, Bybit, OKX, KuCoin, Kraken, Coinbase, Bitget, Gate.io, MEXC, HTX, Bitfinex, Gemini, Bitstamp, Crypto.com, Phemex, BingX, BitMart, Poloniex, Bitrue and WhiteBIT, subject to the installed adapter version.

Use the environment naming pattern `JPTI_<EXCHANGE_ID>_API_KEY` and `JPTI_<EXCHANGE_ID>_API_SECRET`; exchanges that require a passphrase/password use `JPTI_<EXCHANGE_ID>_PASSWORD`. Example for Binance:

```env
JPTI_BINANCE_API_KEY=your_key
JPTI_BINANCE_API_SECRET=your_secret
```

Never paste keys into chat, source files, frontend variables, browser local storage or GitHub. Use read-only keys first; disable withdrawals, restrict key IPs where supported, and only add trade permission after testing.

## API overview

- `GET /api/health`
- `GET /api/exchanges`
- `GET /api/intelligence/overview` — CoinGecko global crypto metrics, DeFiLlama chain TVL, stablecoin supply and protocol fee leaders with per-source status.
- `GET /api/intelligence/macro/:seriesId?limit=120` — FRED observations (requires `JPTI_FRED_API_KEY`).
- `GET /api/intelligence/onchain/evm/:chain/:address/transfers?limit=25` — Alchemy EVM transfer history.
- `GET /api/intelligence/onchain/solana/:address/transactions?limit=25` — Helius Solana address history.
- `POST /api/intelligence/score` — explainable research context score (no order execution).
- `GET /api/intelligence/market/:exchange/:symbol/context?timeframe=1h` — combines selected-exchange OHLCV/ticker, 15m/1h/4h/1d trend alignment where supported, order-book depth and perpetual funding where available, CoinGecko broad crypto regime and DeFiLlama TVL leaders.
- `GET /api/exchanges/:id/status`
- `GET /api/exchanges/:id/markets?type=all&search=BTC`
- `GET /api/exchanges/:id/ticker/:symbol` (example: `/api/exchanges/binance/ticker/BTC-USDT`)
- `GET /api/exchanges/:id/ohlcv/:symbol?timeframe=1h&limit=120`
- `GET /api/exchanges/:id/balance` (private credentials required)
- `POST /api/exchanges/:id/orders` (live endpoint locked by default)

Detailed API and order-gate notes: [api/README.md](api/README.md).

## Live trading safety

Live order execution is disabled by default. The API requires all of the following before it will attempt a live spot order:
1. `JPTI_TRADING_MODE=live`
2. `JPTI_ENABLE_LIVE_TRADING=true`
3. A valid `x-jpti-api-token` header matching `JPTI_API_TOKEN`.
4. The explicit `x-jpti-live-confirmation: I_ACKNOWLEDGE_LIVE_TRADING` header.
5. An active spot market with USDT quote currency and adapter order support.
6. Estimated order notional within `JPTI_MAX_ORDER_NOTIONAL_USDT` (default 100 USDT).

These are initial guardrails, not a complete risk-management or production security system. Keep the API bound to localhost. JPTI is designed to run locally with a Node.js API, web interface, Windows desktop application and Android client. Keep the API bound to localhost on the PC; use secured device settings only over a trusted local network.

## Android local-network access

JPTI supports a native Android client built with Capacitor. The Android app connects to a JPTI API instance running on your Windows PC or another computer on your trusted local network. Build the Android project and debug APK with:

```bat
npm run mobile:android:add
npm run mobile:sync
cd android
gradlew.bat assembleDebug
```

For development, start the local API and web interface with `npm run dev:all`. Configure Android Connection Settings with the PC's reachable API address on your trusted local network. Do not expose the API to the public internet. The Android client does not bundle the Node.js/CCXT backend or automatically synchronize a separate local ledger.

## Architecture direction

Next build stages: authenticated user/workspace model; encrypted credential vault; durable PostgreSQL ledger and audit log; Redis jobs/cache; WebSocket market-data service; per-exchange capability adapters; policy-enforced order service; paper execution engine; portfolio/risk ledger; strategy backtesting and walk-forward validation; Solana DEX intelligence agents; AI research and explainable signal scoring; PWA/Capacitor Android packaging; local Windows desktop and Android application hardening.

## Important risk notice

Crypto and especially newly launched meme tokens can lose most or all value rapidly. No signal or AI output guarantees profit. Begin with read-only exchange keys and paper testing. Never use funds you cannot afford to lose.

## Multi-provider financial data gateway (new integration layer)

JPTI exposes a provider registry at `GET /api/providers` and interval configuration at `GET /api/providers/intervals`. These routes report which credentials are present, the data categories available through adapters, documentation links and polling configuration. Credential presence is not a successful connection; each provider request must succeed to verify access and subscription entitlement.

Implemented read-oriented adapters:
- **Alpaca**: stock and crypto historical bars and paper-account read. Configure `JPTI_ALPACA_API_KEY` and `JPTI_ALPACA_API_SECRET`. Bars: `GET /api/providers/alpaca/bars?symbol=AAPL&timeframe=1Day&feed=iex&limit=100`. Account: `GET /api/providers/alpaca/account` (paper endpoint).
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


## T-Bots multi-agent subsystem integration

JPTI embeds the complete source of [T-Bots](https://github.com/kyleel2249/T-Bots) under `integrations/t-bots/`, preserving its original six-agent paper-trading engine, prompt parser/manager, DEX and simulation feeds, UI, Firebase/Worker adapters, tests and deployment files. The embedded terminal is served at `/t-bots/` by the JPTI API. The upstream repository remains independent. A scheduled GitHub Actions workflow checks upstream hourly, refreshes the embedded source, reapplies the JPTI adapter overlay, and opens a synchronization pull request. The adapter patch fails closed if upstream changes remove expected integration anchors; review strategy/risk changes and CI before merging the sync PR.

The optional JPTI bridge shares auditable bot events through the JPTI append-only ledger and supplies a BTC/USDT market-regime context from JPTI's exchange gateway. Enter the local `JPTI_API_TOKEN` in the T-Bots compose screen to enable it. In live-data mode, a fresh JPTI `risk_off` regime blocks new T-Bots paper entries; existing paper positions continue to be managed by the original T-Bots exit rules. A missing or stale context does not invent a risk state and leaves the original T-Bots rules in control.

**Execution remains paper-only.** T-Bots' live mode means live DEX data, not wallet execution. The bridge does not sign Solana transactions, custody keys, submit swaps, or route JPTI exchange orders. JPTI's independent live-order gateway remains disabled by default. Bot memory events are telemetry, not fills or realized account PnL.


## T-Bots unified multi-chain upgrade

The embedded T-Bots six-agent paper engine now discovers newly surfaced DEX tokens across DexScreener-supported chain IDs instead of filtering discovery to Solana only. It groups token requests by chain and uses RugCheck for Solana and GoPlus token-security data for selected EVM networks (Ethereum, BNB Chain, Polygon, Arbitrum, Optimism, Base, Avalanche, Linea and Blast). Unsupported chains or incomplete security responses fail closed. The six-agent scanner, rug-check, sizer, executor, logger and equity architecture is retained.

T-Bots now consumes a JPTI shared risk state during live-data sessions. Three consecutive losing closed paper trades pause new entries; unavailable risk state also blocks new entries. Existing paper positions continue through their exit logic. JPTI also exposes authenticated multi-chain DEX search with explainable heuristic evidence scoring at `GET /api/integrations/tbots/universe?q=...`.

Important boundaries:
- Discovery is provider-feed-based and is not literally every token pair on every blockchain.
- Chain security fields and LP-lock evidence vary by provider; missing data is not a security pass.
- T-Bots strategies remain new-pair oriented and are not yet independently validated for every token category, CEX instrument, perpetual or derivatives contract.
- JPTI CEX markets, on-chain indexers and DEX pair data are complementary sources, not one universal executable market.
- T-Bots DEX execution remains paper/simulated. No wallet signing, live DEX swaps, bridges or withdrawals are enabled.
- Shared event memory and loss-streak guard are implemented; a fully consolidated JPTI exchange + T-Bots equity/drawdown ledger, production database, chain-by-chain execution adapters and live WebSocket feeds remain future work.

See `integrations/t-bots/JPTI-MULTI-ASSET.md` for endpoint and coverage details.


## Universal T-Bots + JPTI intelligence layer

The embedded T-Bots six-agent engine has been extended from Solana-only discovery to multi-chain DEX discovery plus an optional configured CEX spot watchlist. It preserves the Scanner, Rug Check, Sizer, Executor, Logger and Equity agents.

- Multi-chain DEX feed: DexScreener latest discovery plus an optional 60-address DEX contract watchlist for established tokens; RugCheck for Solana and GoPlus for selected EVM chains. Unsupported/incomplete token security data fails closed.
- CEX spot feed: configure up to 30 USD/stablecoin-quoted exchange:symbol pairs with `JPTI_TBOTS_CEX_MARKETS`. Only active spot instruments meeting quote-volume, visible-depth and spread thresholds are passed to the T-Bots paper engine.
- T-Bots profiles: new pair/meme, established token, DeFi rotation, breakout and mean reversion.
- JPTI Universal Engine workspace: asset-class strategy registry, cross-exchange market context, multi-timeframe trend/RSI/order-book/derivatives evidence, global crypto/DeFi/macro context, DEX security lookup, news discovery and explainable strategy evaluation.
- Shared intelligence: T-Bots submits per-run events and refreshes per-asset JPTI evidence and the unified risk gate. Stale or missing asset evidence blocks new entries when the bridge is enabled.
- Unified performance: closed T-Bots paper trades and exchange fill history are attributed separately; weighted-average exchange realized PnL is kept by quote currency.
- Unified loss controls: consecutive T-Bots paper loss pause and configurable daily realized USD-equivalent loss guard. USD/USDT/USDC/DAI/FDUSD are treated as approximate USD equivalents; other quote currencies remain separate.

New environment settings:
```env
JPTI_TBOTS_DEX_WATCHLIST=solana:YourSolanaMint,base:0xYourTokenContract
JPTI_TBOTS_CEX_MARKETS=binance:BTC/USDT,binance:ETH/USDT,binance:SOL/USDT,bitget:BTC/USDT
JPTI_TBOTS_MAX_CONSECUTIVE_LOSSES=3
JPTI_TBOTS_DAILY_LOSS_LIMIT_USD=100
```

Universal Engine endpoints are documented in `integrations/t-bots/JPTI-MULTI-ASSET.md` and exposed under `/api/universal/*`.

**Scope boundaries:** This is not literally every token pair on every chain or every instrument on every exchange. DexScreener's discovery feed is provider-limited; CEX markets are explicitly watchlisted. The T-Bots executor is still paper-only and supports DEX paper positions and selected CEX spot paper instruments. It does not place live CEX orders, sign Solana/EVM transactions, bridge assets or withdraw funds. Strategy registry coverage for equities, FX, commodities, indices and bonds is a research framework; dedicated live feeds, exchange adapters and validated asset-class strategies remain separate work. Unified risk is based on recorded closed paper trades and recorded exchange fills, not a fully reconciled cross-account equity ledger with unrealized PnL and FX.


### T-Bots upstream adapter safety

The hourly upstream sync continues to bring in T-Bots changes and open a review PR. JPTI-owned integration-critical files now have pinned upstream baselines and separate overlays. If upstream modifies one of those files, the sync script deliberately stops rather than overwriting either side; the change must be reconciled and the baseline/overlay refreshed before the sync PR can proceed. Other upstream files continue to sync normally. This is a guarded review process, not automatic live synchronization or automatic merging.


The Universal Engine also exposes `GET /api/universal/coverage`, a configuration/catalog matrix showing which provider families are configured for each asset class. It intentionally does not claim live provider health or symbol-level entitlement.

The Universal Engine also includes a persisted central T-Bots new-entry pause/resume control. It blocks new paper entries across connected T-Bots sessions while allowing existing positions to continue their configured exits. It does not force-close positions or cancel live exchange orders.


### Multi-instance scheduler coordination

PostgreSQL deployments elect one active operations-scheduler leader using a renewable database lease. Standby instances wait and can take over after expiry; a coordination/database error pauses scheduled workers. Configure `JPTI_SCHEDULER_LEASE_MS`, `JPTI_SCHEDULER_HEARTBEAT_MS`, and optionally `JPTI_SCHEDULER_INSTANCE_ID`. File storage remains single-process only and must not be used for horizontally scaled API instances. See `api/README.md` for the deployment and in-flight-worker limitations.


## Transactional ledger ingestion and outbox

Automatic exchange fill polling now commits each market's normalized ledger batch and its sync cursor in one PostgreSQL transaction. A crash cannot advance the cursor without committing the corresponding fill rows; duplicate trade identities remain protected by the database unique index. Each newly inserted ledger fill also creates a `ledger.transaction.recorded` outbox message in the same transaction. Replays do not create duplicate ledger rows or duplicate outbox records.

Authenticated outbox routes (send `x-jpti-api-token`):
- `GET /api/operations/outbox/status` — pending, processing and delivered counts.
- `POST /api/operations/outbox/claim` — claim up to 100 messages using `{ "workerId": "consumer-name", "limit": 25, "leaseMs": 30000 }`. Claims use PostgreSQL `FOR UPDATE SKIP LOCKED`; expired processing leases can be reclaimed.
- `POST /api/operations/outbox/:id/ack` — acknowledge a message with `{ "workerId": "consumer-name" }`. Only its current lease owner can acknowledge it.
- `POST /api/operations/outbox/:id/retry` — release a failed message for retry with optional `error` and `delayMs` fields. The retry delay is bounded.

Outbox consumers must be idempotent: delivery is at-least-once, not exactly-once. If a consumer completes its side effect and crashes before acknowledgement, the message may be delivered again after its lease expires. Use the stable `event_id` as the consumer's deduplication key. PostgreSQL is required for transactional outbox claiming and acknowledgement. File mode retains replay-safe ledger insertion followed by cursor advancement, but those two writes are not a single crash-atomic transaction and no distributed outbox is available; use PostgreSQL for multi-instance production operation. No live orders or transfers are executed by this feature.


## Ledger-backed trade performance intelligence

The Portfolio & Ledger workspace includes an authenticated performance report at `GET /api/advanced/portfolio/performance`. It calculates realized PnL by quote currency, closed sell-execution win rate, profit factor, expectancy, average win/loss, realized-equity drawdown, daily realized PnL, and attribution by strategy, market, exchange and coarse UTC session. Strategy attribution uses `metadata.strategyId`, `metadata.strategy` or `metadata.botId`; otherwise the fill is explicitly unattributed.

The report uses weighted-average cost per exchange/account/market. It does not call a sell a completed round trip: each matched sell execution is one exit observation. Unmatched sells are counted and warned about, third-currency fees are itemized without invented FX conversion, and quote currencies are never combined. This is realized ledger performance, not total account return or tax reporting. Open-position mark-to-market and derivatives funding remain outside this fill-only report.


## Phase 8 — Shared JPTI / T-Bots intelligence feedback

The local T-Bots integration now includes a bounded browser-local event outbox, sequential retry delivery, stable run-scoped event IDs, and equity telemetry for shared paper-risk analysis. JPTI can pause new T-Bots paper entries when the shared paper-equity drawdown limit is breached. T-Bots rejects stale or unavailable JPTI risk snapshots for new entries while continuing to manage existing exits.

See [Phase 8 shared intelligence documentation](docs/PHASE_8_SHARED_INTELLIGENCE.md). Configure `JPTI_TBOTS_MAX_DRAWDOWN_PCT=10` in the local API environment to set the shared paper drawdown guard. Live trading remains disabled.


## Phase 12 — Universal asset intelligence

JPTI adds a normalized cross-venue instrument universe for crypto spot, perpetual swaps, dated futures, options and margin markets. The Asset Intelligence workspace queries a bounded selection of CCXT venues and exposes instrument structure, settlement, contract size, expiry and metadata status. The quote-quality service validates timestamps, currency consistency and stale observations before calculating a median-based provider consensus with explicit outlier flags. This is metadata and research intelligence; it does not imply live data entitlement or execution support for every asset class. See [API documentation](api/README.md).


## Phase 13 — Explainable multi-agent research council

The AI Intelligence workspace now includes six specialist research engines covering trend, participation, microstructure, derivatives positioning, macro regime and liquidity/volatility risk. Timestamp and source-quality checks are applied before consensus; missing or stale evidence suppresses directional conclusions. Evaluations are persisted in the append-only event journal and can be reviewed. The current specialists are deterministic and explainable, not external LLM agents. They cannot authorize paper entries or live orders. See [API documentation](api/README.md).


## Phase 14 — Portfolio construction and risk parity

The Portfolio Allocation workspace calculates long-only covariance-aware equal-risk-contribution weights from timestamp-aligned historical return series. It enforces one quote currency per calculation, unique instruments, finite aligned observations and explicit minimum/maximum weights. Allocation recommendations are persisted for audit and do not create orders. Historical covariance is not a forecast. See [API documentation](api/README.md).


## Phases 15–21 — Streaming, risk, strategy governance and operational readiness

- **Phase 15 — Market stream gateway:** bounded Server-Sent Events with public CCXT REST ticker polling, per-client cleanup, freshness flags and a live monitor. It is not represented as native exchange WebSocket streaming.
- **Phase 16 — Portfolio stress:** historical VaR, expected shortfall, drawdown and explicit scenario shocks with quote-currency and aligned-return validation.
- **Phase 17 — Pre-trade risk:** fail-closed checks for equity, daily loss, quote freshness, stop placement, risk budget, order notional, gross exposure and symbol concentration. Passing is paper-intent eligibility only.
- **Phase 18 — Strategy registry:** immutable semantic versions, SHA-256 fingerprints, persisted versions and evidence-based paper promotion review.
- **Phase 19 — Market replay:** chronological OHLCV replay with next-candle-open fills, fee/slippage assumptions, drawdown and chronological reporting split.
- **Phase 20 — Observability:** route request/error/latency aggregates, event-loop delay, memory, uptime, storage, scheduler and exchange catalog diagnostics.
- **Phase 21 — Production readiness:** read-only checks for durable storage, distributed scheduler, strong secrets, CORS, risk caps and operator acknowledgement. It never unlocks live trading or creates orders.

All seven phases expose API and dashboard surfaces and include focused automated tests. Their limitations and exact request contracts are documented in [API documentation](api/README.md). Native venue WebSockets, full exchange execution, cross-currency risk, derivatives liquidation modeling, and regulatory certification are not claimed by this delivery.
