import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlphaSignal, normalizeAlphaCandles, runAlphaReplay } from './alpha-signal-engine.js';
const start=1700000000000,tf=3600000;
function candles(count=240,mode='up'){
 return Array.from({length:count},(_,i)=>{const trend=mode==='up'?i*.16:mode==='down'?-i*.16:Math.sin(i/5)*2;const close=100+trend+Math.sin(i/3)*.35;return{timestamp:start+i*tf,open:close-.08,high:close+.45,low:close-.45,close,volume:1000+(i%15)*80};});
}
const account={equity:10000,dailyPnl:0,exposures:[]};
const limits={maxDailyLoss:250,maxOrderNotional:2000,maxGrossExposure:5000,maxRiskPercent:1,maxSymbolConcentrationPercent:25,maxQuoteAgeMs:15000};
function input(mode='up'){const c=candles(240,mode),last=c.at(-1);return{symbol:'BTC/USDT',exchange:'binance',timeframe:'1h',candles:c,quote:{last:last.close,timestamp:new Date(last.timestamp+tf).toISOString()},account,limits,config:{minimumConfidence:55,minimumAgreement:.4}};}
test('normalizes only completed, chronological candles and rejects malformed history',()=>{
 const c=candles();assert.equal(normalizeAlphaCandles(c,'1h',c.at(-1).timestamp+tf).length,c.length);
 assert.equal(normalizeAlphaCandles(c,'1h',c.at(-1).timestamp+tf-1).length,c.length-1);
 const bad=candles();bad[20].timestamp=bad[19].timestamp;assert.throws(()=>normalizeAlphaCandles(bad,'1h',Date.now()),/strictly chronological/);
 assert.throws(()=>normalizeAlphaCandles(c.slice(0,50),'1h',Date.now()),/80–5,000/);
});
test('produces a deterministic, explainable signal fingerprint for identical data and settings',()=>{
 const a=input(),x=evaluateAlphaSignal(a,start+241*tf),y=evaluateAlphaSignal(a,start+241*tf);
 assert.equal(x.signalId,y.signalId);assert.equal(x.evidence.marketDataSha256,y.evidence.marketDataSha256);
 assert.equal(x.evidence.models.length,5);assert.equal(x.evidence.usedOnlyCompletedCandles,true);
 assert.equal(x.confidenceType,'heuristic_consensus_not_probability');assert.equal(x.permissions.liveExecutionAuthorized,false);
});
test('blocks missing or stale quotes and does not mark them paper eligible',()=>{
 const a=input();a.quote.timestamp=new Date(start).toISOString();const r=evaluateAlphaSignal(a,start+241*tf);
 assert.equal(r.qualityChecks.find(x=>x.id==='quote_freshness').passed,false);assert.equal(r.permissions.paperIntentEligible,false);
});
test('fails closed when account exposure inventory is omitted',()=>{
 const a=input();delete a.account.exposures;const r=evaluateAlphaSignal(a,start+241*tf);
 assert.equal(r.riskChecks.find(x=>x.id==='account_exposures').passed,false);assert.equal(r.permissions.paperIntentEligible,false);
});
test('replay is reproducible and reports separate chronological out-of-sample metrics',()=>{
 const c=candles(260);const a={candles:c,timeframe:'1h',config:{minimumConfidence:50,minimumAgreement:.3},feeBps:10,slippageBps:5};
 const x=runAlphaReplay(a,start+261*tf),y=runAlphaReplay(a,start+261*tf);
 assert.deepEqual(x.trades,y.trades);assert.equal(x.data.sha256,y.data.sha256);assert.equal(x.validation.split,'chronological 70/30 by entry candle');
 assert.equal(x.validation.outOfSampleUsedForParameterSelection,false);assert.ok(Number.isFinite(x.overall.endingCapital));
});
test('rejects invalid replay assumptions and timeframe',()=>{
 assert.throws(()=>runAlphaReplay({candles:candles(),timeframe:'2m'},start+241*tf),/Unsupported replay timeframe/);
 assert.throws(()=>runAlphaReplay({candles:candles(),timeframe:'1h',initialCapital:-1},start+241*tf),/positive/);
});
