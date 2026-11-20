# T-Bots ↔ JPTI unified multi-asset integration

T-Bots remains an embedded six-agent paper engine. Its live discovery feed now consumes DexScreener's latest token profiles across supported chain IDs rather than hard-coding Solana. Market pairs are grouped by chain and fetched through the chain-specific token-pairs endpoint. Solana candidates are enriched with RugCheck; supported EVM candidates are enriched with GoPlus token-security data. Unknown chains, missing responses and incomplete security evidence fail closed at the Rug Check agent.

## Coverage and limits

- Discovery is based on DexScreener's latest token-profile feed and pair endpoints. This is a broad, changing discovery universe, not every token pair on every blockchain and not a complete chain archive.
- Supported GoPlus EVM mappings include Ethereum, BNB Chain, Polygon, Arbitrum, Optimism, Base, Avalanche, Linea and Blast. Solana uses RugCheck. Other chains remain fail-closed until a validated security adapter is added.
- Security field coverage differs by provider. An LP lock percentage is not the same as a verifiable lock duration. Missing/unsupported fields do not count as a pass.
- Legacy strategies remain new-pair oriented: age, liquidity, recent volume, holder/security checks and six-agent orchestration still apply. This is not a validated strategy for every asset class.
- DEX token pairs are not the same as CEX spot/perpetual contracts. JPTI's CCXT market catalog and provider/on-chain intelligence remain available through their own APIs; matching symbols do not imply identical instruments or executable routes.
- The DEX executor remains paper/simulated. No wallet signing, DEX swap routing, bridging, withdrawals or live wallet execution is enabled.

## JPTI endpoints

All routes require the x-jpti-api-token header.

- GET /api/integrations/tbots/universe?q=token-or-project — search multi-chain DEX pairs through DexScreener, normalize chain/token/pair metadata and attach a heuristic evidence score. Cached for 30 seconds.
- GET /api/integrations/tbots/risk — summarize published T-Bots closed paper trades, win/loss counts, recent loss streak and shared entry-pause decision.
- GET /api/integrations/tbots/memory?limit=50 — recent T-Bots events from the shared JPTI append-only ledger.
- GET /api/integrations/tbots/context?exchange=binance&symbol=BTC%2FUSDT — selected centralized-market context (ticker, 1h momentum, order-book imbalance, funding where supported and coarse regime).

## Shared risk behavior

T-Bots refreshes selected-market context and shared risk state during live-data sessions. A risk-off selected-market regime or shared memory pause blocks new entries; existing paper positions continue through normal exit management. Three or more consecutive losing closed paper trades trigger the shared memory pause. If the risk endpoint is unavailable, the integration fails closed for new entries. This is not yet a consolidated cross-exchange portfolio equity/drawdown calculation: JPTI exchange portfolio risk and T-Bots paper equity remain separately accounted.

## Run

Start JPTI API and UI with npm run dev:all, open http://localhost:8787/t-bots/, and enter the local JPTI_API_TOKEN in the T-Bots connection field. Keep API credentials server-side. Use paper mode.