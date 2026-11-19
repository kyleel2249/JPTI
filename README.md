# JOPEARL TRADING INTELLIGENCE (JPTI)

JPTI is an extensible trading-intelligence workspace with a React/Vite interface and a server-side Node.js exchange gateway. The gateway uses CCXT adapters to connect to multiple live exchanges through a unified API.

## Implementation status

**Implemented in this build**
- Responsive React dashboard for desktop and mobile browsers.
- Node.js API gateway with live public ticker and market-catalog endpoints.
- Multi-exchange CCXT adapter catalog (availability is detected from the installed CCXT version).
- Server-side private account-balance endpoint for exchanges with configured credentials.
- Locked live spot-order endpoint with explicit environment flags, API-token confirmation, active-market checks, USDT quote restriction and per-order notional cap.
- Exchange selector with dynamic, searchable market discovery across spot, futures, perpetual swaps, margin-enabled instruments, CFDs and options where the selected exchange exposes those products.
- Market type filters, per-exchange product counts and adapter capability metadata; the catalog refreshes every five minutes to discover newly listed and delisted instruments.
- Advanced chart tools: VWAP overlay, Stoch RSI, OBV, price trend bias, horizontal support/resistance levels and two-click trend lines.
- Live OHLCV candlestick chart with selectable exchange-supported timeframes (1m through 1M where supported), zoom controls, fit-to-view and crosshair OHLCV inspection.
- Optional EMA 20, EMA 50 and Bollinger Band overlays; RSI(14), ATR(14), MACD histogram and volume analytics.

- Financial intelligence workspace: CoinGecko global crypto market statistics; DeFiLlama chain TVL, stablecoin supply and protocol-fee leaders; FRED macroeconomic observations when a server-side API key is configured.
- Address-level blockchain history lookups: Alchemy indexed EVM asset transfers (Ethereum, Base, Polygon, Arbitrum and Optimism) and Helius enhanced Solana transactions when provider keys are configured.
- Explainable market-context scoring endpoint that exposes each factor's contribution, confidence tier and caveat; it is a research heuristic, not an autonomous trading instruction.
- Smart Money Concepts (SMC) analysis calculated from closed OHLCV candles: three-candle Fair Value Gaps, confirmed swing-high/low liquidity sweeps, close-confirmed BOS/CHoCH structure breaks, and heuristic last-opposing-candle order-block zones.
- Independent visibility controls for FVG, liquidity sweeps, BOS/CHoCH and order blocks, configurable swing sensitivity (2/3/5/8 bars), chart overlays and an SMC event summary.

**Not yet implemented / not to be mistaken for complete functionality**
- The main candlestick chart and top market strip use live OHLCV/ticker data from the selected exchange. Product availability and market classification are exchange-specific; an instrument is only shown when its adapter reports it in the public catalog. Portfolio balances, PnL, scanner, autonomous-agent status and watchlist sample values remain illustrative until their services are implemented.
- SMC markings are rule-based technical interpretations, not proof of institutional activity. Order blocks are candidate zones, and all signals require trader validation. Multi-timeframe confluence, advanced alerts and SMC-based strategy backtesting are not yet implemented. FVGs are marked filled after a full traversal of the gap, and order-block zones are marked invalidated after a close through the far boundary.
- Financial and on-chain coverage is provider-dependent: CoinGecko/DeFiLlama endpoints are public and may rate-limit; FRED, Alchemy and Helius require user-created server-side API keys. Wallet history is indexed/provider-limited, not a complete chain archive, and wallet ownership/intent is not inferred. The research scoring endpoint is not yet a validated backtested strategy or an order trigger. Equities, bonds, FX and commodity feeds are not yet connected as live tradable market feeds; FRED provides selected macroeconomic time series only.\n- No persistent user accounts, encrypted credential vault, PostgreSQL/Redis storage, authenticated multi-user cloud gateway, production WebSocket streaming, full futures/margin execution, copy-trading engine, strategy execution engine, AI model inference, institutional portfolio ledger or native Android APK yet.
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
- `GET /api/intelligence/overview` — CoinGecko global crypto metrics, DeFiLlama chain TVL, stablecoin supply and protocol fee leaders with per-source status.\n- `GET /api/intelligence/macro/:seriesId?limit=120` — FRED observations (requires `JPTI_FRED_API_KEY`).\n- `GET /api/intelligence/onchain/evm/:chain/:address/transfers?limit=25` — Alchemy EVM transfer history.\n- `GET /api/intelligence/onchain/solana/:address/transactions?limit=25` — Helius Solana address history.\n- `POST /api/intelligence/score` — explainable research context score (no order execution).\n- `GET /api/exchanges/:id/status`
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

These are initial guardrails, not a complete risk-management or production security system. Keep the API bound to localhost. Do not expose it directly to the public internet or deploy it to Cloudflare as-is. Production cloud operation requires authentication, TLS, encrypted secret management, durable audit logging, user-level authorization, network restrictions, monitoring, rate limiting at the edge, kill switches and independent security review.

## Android

The responsive web interface can be opened on Android while the phone and PC share Wi-Fi. Start JPTI with `npm run dev:all`, run `ipconfig` on Windows, then open `http://PC-IP-ADDRESS:5173` in Android Chrome. Allow Node.js through Windows Firewall on Private networks only. The API remains bound to the PC loopback interface and is accessed through the Vite proxy. This is a web app, not a native APK.

## Architecture direction

Next build stages: authenticated user/workspace model; encrypted credential vault; durable PostgreSQL ledger and audit log; Redis jobs/cache; WebSocket market-data service; per-exchange capability adapters; policy-enforced order service; paper execution engine; portfolio/risk ledger; strategy backtesting and walk-forward validation; Solana DEX intelligence agents; AI research and explainable signal scoring; PWA/Capacitor Android packaging; hardened Cloudflare deployment.

## Important risk notice

Crypto and especially newly launched meme tokens can lose most or all value rapidly. No signal or AI output guarantees profit. Begin with read-only exchange keys and paper testing. Never use funds you cannot afford to lose.