# JOPEARL TRADING INTELLIGENCE (JPTI)

JPTI is an extensible trading-intelligence workspace with a React/Vite interface and a server-side Node.js exchange gateway. The gateway uses CCXT adapters to connect to multiple live exchanges through a unified API.

## Implementation status

**Implemented in this build**
- Responsive React dashboard for desktop and mobile browsers.
- Node.js API gateway with live public ticker and market-catalog endpoints.
- Multi-exchange CCXT adapter catalog (availability is detected from the installed CCXT version).
- Server-side private account-balance endpoint for exchanges with configured credentials.
- Locked live spot-order endpoint with explicit environment flags, API-token confirmation, active-market checks, USDT quote restriction and per-order notional cap.
- Exchange connectivity panel in the dashboard with gateway health, exchange selection, configured-key status and live BTC/USDT ticker refresh.

**Not yet implemented / not to be mistaken for complete functionality**
- The original chart, order book, sample balances, performance metrics and some market watchlist values are still illustrative; the live ticker panel is the current real-data integration.
- No persistent user accounts, encrypted credential vault, PostgreSQL/Redis storage, authenticated multi-user cloud gateway, production WebSocket streaming, full futures/margin execution, copy-trading engine, strategy execution engine, AI model inference, institutional portfolio ledger or native Android APK yet.
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
- `GET /api/exchanges/:id/status`
- `GET /api/exchanges/:id/markets`
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