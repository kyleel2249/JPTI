import test from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGY_PROFILES, classifyInstrument, evaluateStrategyProfile, calculateUnifiedRisk, buildUnifiedPerformance } from './universal-engine.js';

test('strategy registry covers spot, perpetuals, tokens, equities and macro assets', () => {
  assert.ok(STRATEGY_PROFILES.spot_trend.assetClasses.includes('crypto_spot'));
  assert.ok(STRATEGY_PROFILES.perp_momentum.assetClasses.includes('crypto_perpetual'));
  assert.ok(STRATEGY_PROFILES.equity_swing.assetClasses.includes('equity'));
  assert.equal(classifyInstrument({market:{swap:true}}).assetClass,'crypto_perpetual');
  assert.equal(classifyInstrument({chain:'base',pair:{}}).assetClass,'token');
});

test('strategy evaluation is explicit about missing evidence and never issues an order', () => {
  const result=evaluateStrategyProfile('spot_trend',{momentumPct:4,relativeVolume:2,timeframeAlignment:1,liquidityUsd:50000});
  assert.equal(result.status,'research_candidate');
  assert.equal(result.decision,'research-only; not an order instruction');
  const missing=evaluateStrategyProfile('spot_trend',{momentumPct:4});
  assert.equal(missing.status,'insufficient_or_conflicting_evidence');
  assert.ok(missing.missingEvidence.includes('relativeVolume'));
});

test('unified risk gate pauses on a consecutive paper loss streak', () => {
  const events=[-1,-2,-3].map((pnl,i)=>({source:'tbots',eventType:'bot_trade',occurredAt:new Date(Date.now()-i*1000).toISOString(),metadata:{action:'paper_closed',pnl}}));
  const risk=calculateUnifiedRisk(events);
  assert.equal(risk.newEntriesAllowed,false);
  assert.ok(risk.pauseReasons.includes('consecutive_paper_loss_limit'));
  assert.equal(risk.exitsRemainEnabled,true);
});

test('unified performance attributes paper results and exchange fills separately', () => {
  const events=[
    {source:'tbots',eventType:'bot_trade',symbol:'ABC',metadata:{action:'paper_closed',pnl:5}},
    {source:'binance',eventType:'fill',side:'buy',quantity:2,fee:0.1,feeCurrency:'USDT'}
  ];
  const report=buildUnifiedPerformance(events);
  assert.equal(report.paperStrategy.closedTrades,1);
  assert.equal(report.paperStrategy.realizedPnlUsd,5);
  assert.equal(report.exchangeExecution.fillCount,1);
  assert.equal(report.exchangeExecution.realizedPnl,'weighted-average on recorded spot fills only; quote currencies remain separate');
  assert.equal(report.paperStrategy.byStrategy.untagged.trades,1);
});

test('exchange fill realized PnL uses weighted average and preserves quote currencies', async () => {
  const { calculateExchangeRealized } = await import('./universal-engine.js');
  const now=Date.now();
  const events=[
    {source:'binance',accountId:'a',eventType:'fill',symbol:'BTC/USDT',side:'buy',quantity:1,price:100,fee:0,occurredAt:new Date(now-3000).toISOString()},
    {source:'binance',accountId:'a',eventType:'fill',symbol:'BTC/USDT',side:'buy',quantity:1,price:120,fee:0,occurredAt:new Date(now-2000).toISOString()},
    {source:'binance',accountId:'a',eventType:'fill',symbol:'BTC/USDT',side:'sell',quantity:1,price:130,fee:1,feeCurrency:'USDT',occurredAt:new Date(now-1000).toISOString()}
  ];
  const result=calculateExchangeRealized(events,now);
  assert.equal(result.realizedByQuote.USDT,19);
  assert.equal(result.openInventory[0].quantity,1);
  assert.equal(result.openInventory[0].averageCost,110);
});

test('DeFi strategy requires protocol TVL, fees and risk evidence', () => {
  const missing=evaluateStrategyProfile('defi_rotation',{liquidityUsd:50000});
  assert.equal(missing.status,'insufficient_or_conflicting_evidence');
  assert.ok(missing.missingEvidence.includes('tvlChangePct'));
  const complete=evaluateStrategyProfile('defi_rotation',{liquidityUsd:50000,tvlChangePct:8,feesChangePct:12,protocolRiskScore:10});
  assert.equal(complete.missingEvidence.length,0);
  assert.equal(complete.decision,'research-only; not an order instruction');
});
