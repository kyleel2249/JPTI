# JOPEARL TRADING INTELLIGENCE (JPTI)

Responsive trading-intelligence workspace starter. Independent interface inspired by common professional exchange-terminal patterns; not affiliated with or a reproduction of Bitget.

## Current status

UI prototype / paper-mode foundation. Sample prices, order book and balances are illustrative. No exchange is connected and no real orders are sent. Live trading is disabled by design.

## Windows setup

1. Install Node.js 22 LTS from https://nodejs.org/ (npm is included).
2. Open a new Command Prompt and verify `node -v` and `npm -v`.
3. Clone: `git clone https://github.com/kyleel2249/JPTI.git`
4. Enter: `cd JPTI`
5. Install: `npm install`
6. Run: `npm run dev`
7. Open the URL printed by Vite, normally http://localhost:5173.
8. Production build: `npm run build`; preview: `npm run preview`.

## Android on the same Wi-Fi

1. On Windows run `npm run dev -- --host 0.0.0.0`.
2. Run `ipconfig` and note the PC's IPv4 address.
3. On Android Chrome, visit `http://PC-IP-ADDRESS:5173` while both devices share Wi-Fi.
4. If prompted, allow Node.js through Windows Firewall on Private networks only. Do not expose the dev server publicly.

This starter is a responsive web app, not a native APK. PWA installation and Capacitor packaging are future steps.

## Planned modules

Spot/futures terminal, charts and indicators, AI intelligence, trader research/copy controls, automated bots, institutional risk, portfolio/PnL, scanner/signals, economic calendar/session clock, multi-exchange adapters, backtesting/strategy lab, and Solana new-pair research agents.

## Safety

Paper mode is default. Do not enable unattended live trading without explicit user authorization, thorough testing and configured risk limits. Keep exchange secrets server-side only, never in browser code, `VITE_` variables, local storage or Git. Use least-privilege API keys with withdrawals disabled. Require rug-check PASS plus at least two independent signals before paper entries. Simulated returns must never be represented as verified performance. Meme coins can lose all value rapidly.

Suggested backend architecture: Node.js/TypeScript API, PostgreSQL, Redis, WebSocket market-data gateway, exchange adapters, isolated strategy workers and a policy-enforced execution service.