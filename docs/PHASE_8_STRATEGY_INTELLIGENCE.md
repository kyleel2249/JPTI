# Phase 8 — Strategy Intelligence & Paper Entry Governance

## Scope

This phase adds a historical strategy feedback loop and a centralized, explainable paper-entry preflight. It extends the existing JPTI–T-Bots event ledger and unified risk controls. It does not enable live orders, connect to Cloudflare, or require a hosted service.

## Strategy scorecards

**Endpoint:** `GET /api/universal/strategy/scorecards?days=90&minTrades=20`

- Reads persisted JPTI ledger events and includes only T-Bots `bot_trade` events with `metadata.action=paper_closed`.
- Groups outcomes by the recorded `strategyProfile`; missing tags are explicitly grouped as `untagged`.
- Reports closed-trade count, wins/losses, win rate, total PnL, expectancy per trade, average win/loss, profit factor, maximum closed-trade-equity drawdown, asset-class and venue counts, and last trade timestamp.
- Labels sample quality as `insufficient_sample`, `early_sample`, or `usable_for_review`. The minimum sample is a review threshold, not statistical proof.
- Keeps paper strategy results separate from exchange fills and exchange portfolio accounting.

## Paper entry preflight

**Endpoint:** `POST /api/universal/entry-preflight`

Example request:

```json
{
  "profileId": "spot_trend",
  "assetClass": "crypto_spot",
  "observedAt": "2026-11-20T12:00:00.000Z",
  "evidence": {
    "momentumPct": 2.4,
    "relativeVolume": 1.8,
    "timeframeAlignment": 0.75,
    "liquidityUsd": 250000
  }
}
```

- Requires the private JPTI API authorization policy.
- Reuses the strategy profile's required evidence and explainable score.
- Rechecks persisted unified risk and refuses new-entry eligibility if the shared pause is active or risk configuration is invalid.
- Requires a recent evidence timestamp. The maximum age is clamped to 15–300 seconds and defaults to 90 seconds.
- For token/Dex asset classes (`token`, `dex_token`, `meme_token`, `new_pair`), requires an independent security status of `clear` or `passed`.
- Returns `allowed`, a list of block reasons, strategy evidence, risk state, evidence freshness and security-gate status.
- This endpoint is a paper/research eligibility check only. It never creates, submits, or authorizes an order.

## Dashboard

The Universal Engine now loads strategy scorecards alongside unified risk, performance and portfolio data. The scorecard table exposes sample quality so a small number of trades cannot be mistaken for a proven edge.

## Operational and safety boundaries

- T-Bots continues to run in paper mode. Existing position exits remain independent of new-entry pause controls.
- A passing strategy score is not a calibrated probability, forecast, or guarantee.
- Historical outcomes are affected by sample size, market regime, slippage assumptions, fees, selection bias and missing metadata.
- A scorecard marked `usable_for_review` is eligible for deeper validation, not automatic promotion. Walk-forward testing, out-of-sample validation, realistic fees/slippage and drawdown review are still required.
- No live trading behavior is added or unlocked by this phase.
- Local Windows remains the JPTI API host; Android remains a secure client to that local API.

## Validation

CI runs the existing syntax checks, full Node test suite and Vite production build. The new unit tests cover profile isolation, lookback filtering, expectancy, profit factor and low-sample labeling.
