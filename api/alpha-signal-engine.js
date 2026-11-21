import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { appendStoredEvent, readStoredEvents } from './storage.js';
import { evaluatePretradeRisk } from './pretrade-risk.js';
import { requirePrivateApiAuth } from './policy.js';

export const alphaSignalRouter = express.Router();
export const ALPHA_ENGINE_VERSION = '1.0.0';
const TIMEFRAMES = { '1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'2h':7200000,'4h':14400000,'6h':21600000,'12h':43200000,'1d':86400000,'1w':604800000 };
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const finite = v => Number.isFinite(Number(v));
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const round = (v,n=8) => Number(Number(v).toFixed(n));
const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const stddev = values => { const m=mean(values); return values.length>1 ? Math.sqrt(mean(values.map(x=>(x-m)**2))) : 0; };
const ema = (values,period) => { const alpha=2/(period+1),out=[]; let v=values[0]; for(let i=0;i<values.length;i++){v=i===0?values[i]:values[i]*alpha+v*(1-alpha);out.push(v);} return out; };
const timeframeMs = value => TIMEFRAMES[String(value)] || null;

export function normalizeAlphaCandles(input, timeframe, now=Date.now()) {
  if (!Array.isArray(input) || input.length < 80 || input.length > 5000) throw new Error('Alpha analysis requires 80–5,000 OHLCV candles.');
  const tf = timeframeMs(timeframe);
  if (!tf) throw new Error('Unsupported timeframe. Use a supported interval from 1m through 1w.');
  const rows = input.map((c,i) => {
    const row = Array.isArray(c) ? { timestamp:c[0],open:c[1],high:c[2],low:c[3],close:c[4],volume:c[5] } : c;
    const values = ['timestamp','open','high','low','close','volume'].map(k=>Number(row?.[k]));
    if (!values.every(Number.isFinite)) throw new Error('Candle '+i+' contains a missing or non-finite OHLCV field.');
    const [timestamp,open,high,low,close,volume]=values;
    if (timestamp<=0 || Math.min(open,high,low,close)<=0 || volume<0 || high<Math.max(open,close,low) || low>Math.min(open,close,high)) throw new Error('Candle '+i+' violates positive-price or OHLC consistency rules.');
    if (i && timestamp<=Number((Array.isArray(input[i-1])?input[i-1][0]:input[i-1].timestamp))) throw new Error('Candles must be strictly chronological with unique timestamps.');
    return { timestamp,open,high,low,close,volume };
  });
  const completed = rows.filter(c=>c.timestamp+tf<=now);
  if (completed.length<80) throw new Error('At least 80 completed candles are required; the active candle is excluded.');
  return completed;
}

function rsi(values,period=14) {
  let gains=0,losses=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gains+=Math.max(0,d);losses+=Math.max(0,-d);}
  let avgGain=gains/period,avgLoss=losses/period,out=Array(values.length).fill(null);
  out[period]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];avgGain=(avgGain*(period-1)+Math.max(0,d))/period;avgLoss=(avgLoss*(period-1)+Math.max(0,-d))/period;out[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);}
  return out;
}
function atr(candles,period=14) {
  const tr=candles.map((c,i)=>i===0?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)));
  return mean(tr.slice(-period));
}
function buildEvidence(candles) {
  const closes=candles.map(c=>c.close),volumes=candles.map(c=>c.volume),last=closes.length-1;
  const fast=ema(closes,9),slow=ema(closes,21),ema12=ema(closes,12),ema26=ema(closes,26),macdLine=ema12.map((v,i)=>v-ema26[i]),macdSignal=ema(macdLine,9),rsiValues=rsi(closes,14);
  const recent=candles.slice(-21,-1),priorHigh=Math.max(...recent.map(c=>c.high)),priorLow=Math.min(...recent.map(c=>c.low));
  const volumeBase=mean(volumes.slice(-21,-1)),volumeRatio=volumeBase>0?volumes[last]/volumeBase:null;
  const closes20=closes.slice(-20),mean20=mean(closes20),sd20=stddev(closes20),zScore=sd20>0?(closes[last]-mean20)/sd20:0;
  const atr14=atr(candles,14),atrPct=atr14/closes[last]*100;
  const trendDirection=fast[last]>slow[last]&&fast[last]>fast[last-3]?1:fast[last]<slow[last]&&fast[last]<fast[last-3]?-1:0;
  const momentumDirection=macdLine[last]>macdSignal[last]&&rsiValues[last]>52?1:macdLine[last]<macdSignal[last]&&rsiValues[last]<48?-1:0;
  const breakoutDirection=closes[last]>priorHigh?1:closes[last]<priorLow?-1:0;
  const volumeDirection=volumeRatio!==null&&volumeRatio>=1.15?(closes[last]>closes[last-1]?1:closes[last]<closes[last-1]?-1:0):0;
  const reversionDirection=zScore<=-1.6?1:zScore>=1.6?-1:0;
  const models=[
    {id:'trend',label:'EMA trend structure',weight:.26,direction:trendDirection,evidence:trendDirection===1?'EMA 9 is above EMA 21 and rising':trendDirection===-1?'EMA 9 is below EMA 21 and falling':'EMA trend is mixed or flat'},
    {id:'momentum',label:'MACD and RSI momentum',weight:.24,direction:momentumDirection,evidence:momentumDirection===1?'MACD is above its signal and RSI confirms bullish momentum':momentumDirection===-1?'MACD is below its signal and RSI confirms bearish momentum':'MACD/RSI momentum confirmation is mixed'},
    {id:'breakout',label:'20-bar range breakout',weight:.20,direction:breakoutDirection,evidence:breakoutDirection===1?'Close broke above the prior 20-bar high':breakoutDirection===-1?'Close broke below the prior 20-bar low':'No confirmed 20-bar range break'},
    {id:'participation',label:'Volume participation',weight:.12,direction:volumeDirection,evidence:volumeDirection?'Volume expansion confirms the latest directional candle':'Volume expansion confirmation is absent'},
    {id:'mean_reversion',label:'Mean-reversion pressure',weight:.18,direction:reversionDirection,evidence:reversionDirection===1?'Price is statistically stretched below its 20-bar mean':reversionDirection===-1?'Price is statistically stretched above its 20-bar mean':'Price is not at the configured statistical extreme'}
  ];
  const score=models.reduce((s,m)=>s+m.direction*m.weight,0);
  const direction=score>=.18?'buy':score<=-.18?'sell':'neutral';
  const active=models.filter(m=>m.direction!==0),agreeing=active.filter(m=>m.direction===(direction==='buy'?1:direction==='sell'?-1:0)).length;
  const directionalAgreement=active.length?agreeing/active.length:0;
  const confidence=round(clamp(50+Math.abs(score)*48+(directionalAgreement-.5)*12,0,95),2);
  const atrPercent=atrPct;
  const regime=atrPercent>=3?'high_volatility':atrPercent<=.35?'low_volatility':'normal_volatility';
  return {direction,score:round(score,5),confidence,directionalAgreement:round(directionalAgreement,4),models:models.map(m=>({...m,weight:round(m.weight,2)})),
    indicators:{ema9:round(fast[last]),ema21:round(slow[last]),rsi14:round(rsiValues[last],2),macd:round(macdLine[last]),macdSignal:round(macdSignal[last]),volumeRatio:volumeRatio===null?null:round(volumeRatio,3),zScore20:round(zScore,3),atr14:round(atr14),atrPercent:round(atrPct,3),prior20High:round(priorHigh),prior20Low:round(priorLow)},
    marketRegime:regime,methodology:'Deterministic weighted ensemble of trend, momentum, breakout, volume participation and mean-reversion evidence. Confidence is a heuristic consensus score, not a calibrated probability.'};
}
function canonicalConfig(config={}) {
  return {minimumConfidence:clamp(Number(config.minimumConfidence)||66,50,95),minimumAgreement:clamp(Number(config.minimumAgreement)||.6,.2,1),
    atrStopMultiple:clamp(Number(config.atrStopMultiple)||1.5,.5,5),targetOneR:clamp(Number(config.targetOneR)||1,0.5,5),
    targetTwoR:clamp(Number(config.targetTwoR)||2,1,8),riskPercent:clamp(Number(config.riskPercent)||.5,.1,2)};
}
export function evaluateAlphaSignal(input={}, now=Date.now()) {
  const symbol=String(input.symbol||'').trim().toUpperCase(),exchange=String(input.exchange||'').trim().toLowerCase(),timeframe=String(input.timeframe||'');
  if(!/^[A-Z0-9._-]{2,20}\/[A-Z0-9._-]{2,20}$/.test(symbol)) throw new Error('Use a normalized BASE/QUOTE symbol such as BTC/USDT.');
  if(!/^[a-z0-9_-]{2,30}$/.test(exchange)) throw new Error('A valid exchange identifier is required.');
  const tf=timeframeMs(timeframe);if(!tf)throw new Error('Unsupported timeframe.');
  const candles=normalizeAlphaCandles(input.candles,timeframe,now),last=candles.at(-1),config=canonicalConfig(input.config),account=input.account||{},limits=input.limits||{},quoteCurrency=symbol.split('/')[1];
  const marketHash=sha(candles),configHash=sha(config),evidence=buildEvidence(candles);
  const quote=input.quote||{},quotePrice=Number(quote.last),quoteTime=Date.parse(String(quote.timestamp||''));
  const quoteAgeMs=Number.isFinite(quoteTime)?now-quoteTime:null,quoteValid=Number.isFinite(quotePrice)&&quotePrice>0&&quoteAgeMs!==null&&quoteAgeMs>=-5000&&quoteAgeMs<=15000;
  const candleAgeMs=now-(last.timestamp+tf);
  const qualityChecks=[
    {id:'completed_history',passed:candles.length>=80,detail:'At least 80 completed candles were used; the active candle was excluded.'},
    {id:'candle_freshness',passed:candleAgeMs>=0&&candleAgeMs<=tf*2,detail:'The last completed OHLCV candle must be no more than two timeframe intervals old.'},
    {id:'account_quote_currency',passed:String(account.currency||'').trim().toUpperCase()===quoteCurrency,detail:'Account equity and all supplied exposure market values must be normalized to the instrument quote currency ('+quoteCurrency+').'},
    {id:'quote_freshness',passed:quoteValid,detail:'A positive exchange quote timestamped within 15 seconds is required.'},
    {id:'signal_direction',passed:evidence.direction!=='neutral',detail:'The ensemble must produce a directional BUY or SELL consensus.'},
    {id:'confidence_threshold',passed:evidence.confidence>=config.minimumConfidence,detail:'Heuristic confidence must meet the configured minimum.'},
    {id:'model_agreement',passed:evidence.directionalAgreement>=config.minimumAgreement,detail:'Active specialist models must meet the minimum directional agreement.'},
    {id:'volatility_guard',passed:evidence.marketRegime!=='high_volatility',detail:'High-volatility regimes are blocked by the default safety policy.'},
    {id:'valid_stop_geometry',passed:stopPrice>0&&riskDistance>0&&tp1>0&&tp2>0,detail:'ATR-based stop and target levels must all be positive and geometrically valid.'}
  ];
  const entry=quoteValid?quotePrice:last.close,side=evidence.direction,stopDistance=evidence.indicators.atr14*config.atrStopMultiple;
  const stopPrice=side==='buy'?entry-stopDistance:side==='sell'?entry+stopDistance:null;
  const riskDistance=stopPrice===null?null:Math.abs(entry-stopPrice);
  const tp1=side==='buy'?entry+riskDistance*config.targetOneR:side==='sell'?entry-riskDistance*config.targetOneR:null;
  const tp2=side==='buy'?entry+riskDistance*config.targetTwoR:side==='sell'?entry-riskDistance*config.targetTwoR:null;
  const equity=Number(account.equity),maxNotional=Number(limits.maxOrderNotional);
  const riskBudget=Number.isFinite(equity)&&equity>0?equity*config.riskPercent/100:null;
  const rawQty=riskDistance>0&&riskBudget!==null?riskBudget/riskDistance:null;
  const quantity=rawQty!==null&&Number.isFinite(maxNotional)&&maxNotional>0?Math.min(rawQty,maxNotional/entry):null;
  let pretrade=null;
  if(side!=='neutral'&&quoteValid&&quantity>0&&stopPrice>0){
    pretrade=evaluatePretradeRisk({account,limits,order:{symbol,side,quantity,referencePrice:entry,stopPrice,quoteTimestamp:new Date(quoteTime).toISOString()}},now);
  }
  const riskChecks=pretrade?.checks||[{id:'risk_inputs',passed:false,detail:'A valid directional setup, fresh quote, account equity and positive order-notional cap are required before risk preflight.'}];
  const qualityPassed=qualityChecks.every(c=>c.passed),riskPassed=Boolean(pretrade?.permissions?.paperIntentEligible);
  const eligible=qualityPassed&&riskPassed;
  const quoteHash=sha({last:quotePrice,timestamp:quoteTime});
  const fingerprint=sha([ALPHA_ENGINE_VERSION,symbol,exchange,timeframe,last.timestamp,marketHash,quoteHash,configHash].join('|'));
  const signalId='alpha_'+fingerprint.slice(0,32);
  return {signalId,engine:'JPTI Alpha Signal Engine',engineVersion:ALPHA_ENGINE_VERSION,generatedAt:new Date(now).toISOString(),
    market:{exchange,symbol,timeframe,quoteCurrency,lastCompletedCandleAt:new Date(last.timestamp).toISOString(),candleAgeMs,completedCandles:candles.length,referencePrice:round(entry),quoteAgeMs},
    direction:side,confidence:evidence.confidence,confidenceType:'heuristic_consensus_not_probability',ensembleScore:evidence.score,modelAgreement:evidence.directionalAgreement,
    marketRegime:evidence.marketRegime,levels:{entry:round(entry),stopLoss:stopPrice===null?null:round(stopPrice),takeProfitOne:tp1===null?null:round(tp1),takeProfitTwo:tp2===null?null:round(tp2),riskRewardOne:config.targetOneR,riskRewardTwo:config.targetTwoR,atrStopMultiple:config.atrStopMultiple},
    sizing:{riskPercent:config.riskPercent,riskBudget:riskBudget===null?null:round(riskBudget),quantity:quantity===null?null:round(quantity),notional:quantity===null?null:round(quantity*entry),method:'risk budget divided by ATR stop distance, capped by configured per-order notional'},
    evidence:{...evidence,marketDataSha256:marketHash,quoteSha256:quoteHash,configurationSha256:configHash,signalFingerprint:fingerprint,usedOnlyCompletedCandles:true,lookaheadBias:'none_in_signal_calculation'},
    qualityChecks,riskChecks,pretradeRisk:pretrade,decision:eligible?'paper_intent_eligible':'blocked',
    permissions:{paperIntentEligible:eligible,liveExecutionAuthorized:false,exchangeOrdersCreated:0},
    limitations:['Confidence is a deterministic consensus heuristic, not a statistically calibrated probability.','The five specialist models are deterministic technical rules, not autonomous LLM agents.','Signal evaluation uses completed OHLCV candles and a separately timestamped exchange quote.','Paper eligibility is not a live-order authorization or a profitability guarantee.']};
}
function tradeMetrics(trades) {
  const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),gp=wins.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(losses.reduce((s,t)=>s+t.pnl,0)),net=trades.reduce((s,t)=>s+t.pnl,0);
  let equity=10000,peak=equity,maxDd=0;for(const t of trades){equity+=t.pnl;peak=Math.max(peak,equity);maxDd=Math.max(maxDd,(peak-equity)/peak);}
  return {trades:trades.length,wins:wins.length,losses:losses.length,winRatePercent:trades.length?round(wins.length/trades.length*100,2):null,profitFactor:gl?round(gp/gl,3):gp?null:0,netPnl:round(net,4),expectancy:trades.length?round(net/trades.length,4):null,maxDrawdownPercent:round(maxDd*100,3)};
}
export function runAlphaReplay(input={}, now=Date.now()) {
  const timeframe=input.timeframe||'1h',tf=timeframeMs(timeframe);if(!tf)throw new Error('Unsupported replay timeframe.');
  const candles=normalizeAlphaCandles(input.candles,timeframe,now),config=canonicalConfig(input.config),feeBps=input.feeBps==null?10:Number(input.feeBps),slippageBps=input.slippageBps==null?5:Number(input.slippageBps),initialCapital=input.initialCapital==null?10000:Number(input.initialCapital);
  if(!Number.isFinite(feeBps)||feeBps<0||feeBps>100||!Number.isFinite(slippageBps)||slippageBps<0||slippageBps>100)throw new Error('Fee and slippage assumptions must be between 0 and 100 basis points.');
  if(!Number.isFinite(initialCapital)||initialCapital<=0)throw new Error('Initial capital must be positive.');
  const trades=[],split=Math.floor(candles.length*.7);let capital=initialCapital,activeUntil=0;
  for(let i=79;i<candles.length-1;i++){
    if(i<activeUntil)continue;
    const window=candles.slice(0,i+1),analysis=buildEvidence(window),last=candles[i];
    if(analysis.direction==='neutral'||analysis.confidence<config.minimumConfidence||analysis.directionalAgreement<config.minimumAgreement||analysis.marketRegime==='high_volatility')continue;
    const side=analysis.direction,entryBar=candles[i+1],entry=entryBar.open,stopDistance=analysis.indicators.atr14*config.atrStopMultiple;
    if(!(entry>0&&stopDistance>0&&stopDistance<entry))continue;
    const stop=side==='buy'?entry-stopDistance:entry+stopDistance,target=side==='buy'?entry+stopDistance*config.targetTwoR:entry-stopDistance*config.targetTwoR;
    const riskBudget=capital*config.riskPercent/100,qty=Math.min(riskBudget/stopDistance,capital*.95/entry);
    if(!(qty>0))continue;
    const entryFill=entry*(side==='buy'?1+slippageBps/10000:1-slippageBps/10000),entryFee=entryFill*qty*feeBps/10000;
    let exitPrice=null,exitIndex=null,exitReason='max_holding_period';
    const maxHold=Math.min(candles.length-1,i+49);
    for(let j=i+1;j<=maxHold;j++){
      const bar=candles[j],stopHit=side==='buy'?bar.low<=stop:bar.high>=stop,targetHit=side==='buy'?bar.high>=target:bar.low<=target;
      if(stopHit){exitPrice=stop;exitIndex=j;exitReason='stop_loss';break;}
      if(targetHit){exitPrice=target;exitIndex=j;exitReason='take_profit_2';break;}
    }
    if(exitPrice===null){exitIndex=maxHold;exitPrice=candles[maxHold].close;}
    const exitFill=exitPrice*(side==='buy'?1-slippageBps/10000:1+slippageBps/10000),gross=(exitFill-entryFill)*qty*(side==='buy'?1:-1),fees=entryFee+exitFill*qty*feeBps/10000,pnl=gross-fees;
    const trade={side,signalAt:new Date(last.timestamp).toISOString(),entryAt:new Date(entryBar.timestamp).toISOString(),exitAt:new Date(candles[exitIndex].timestamp).toISOString(),entry:round(entryFill),exit:round(exitFill),stop:round(stop),target:round(target),quantity:round(qty),fees:round(fees),pnl:round(pnl,4),returnPercent:round(pnl/(entryFill*qty)*100,4),exitReason,split:entryBar.timestamp<candles[split].timestamp?'in_sample':'out_of_sample'};
    trades.push(trade);capital+=pnl;activeUntil=exitIndex;
  }
  const inSample=trades.filter(t=>t.split==='in_sample'),outOfSample=trades.filter(t=>t.split==='out_of_sample');
  return {engineVersion:ALPHA_ENGINE_VERSION,generatedAt:new Date(now).toISOString(),timeframe,parameters:{...config,feeBps,slippageBps,initialCapital},data:{candles:candles.length,first:new Date(candles[0].timestamp).toISOString(),last:new Date(candles.at(-1).timestamp).toISOString(),sha256:sha(candles),chronological:true,completedCandlesOnly:true},
    overall:{...tradeMetrics(trades),endingCapital:round(initialCapital+trades.reduce((s,t)=>s+t.pnl,0),4)},inSample:tradeMetrics(inSample),outOfSample:tradeMetrics(outOfSample),
    trades:trades.slice(-500),validation:{split:'chronological 70/30 by entry candle',outOfSampleUsedForParameterSelection:false,fill:'next candle open',intrabarAmbiguity:'stop is assumed to execute first if stop and target are both touched in one candle',overlappingPositions:false},
    limitations:['Single instrument, long/short simulation with one open position at a time.','No exchange order-book queue, partial fills, market impact, funding, leverage or liquidation model.','Fixed fee and slippage assumptions; actual venue costs may differ.','OHLCV intrabar ordering is unknown; conservative stop-first handling is used.','Historical replay is not proof of future profitability or a production promotion certificate.']};
}
async function persistEvent(kind,source,eventType,externalId,payload,occurredAt=new Date().toISOString()){
 return appendStoredEvent({kind,source,eventType,externalId,occurredAt,payload});
}
export function evaluatePaperExit(intent,markPrice){
 const price=Number(markPrice);if(!Number.isFinite(price)||price<=0)throw new Error('Paper mark price must be positive.');
 if(intent.direction==='buy'){if(price<=intent.stopLoss)return 'stop_loss';if(price>=intent.takeProfitTwo)return 'take_profit_2';}
 else if(intent.direction==='sell'){if(price>=intent.stopLoss)return 'stop_loss';if(price<=intent.takeProfitTwo)return 'take_profit_2';}
 else throw new Error('Paper trade direction is invalid.');
 return null;
}
function protectedRoute(handler){return async(req,res)=>{try{requirePrivateApiAuth(req);await handler(req,res);}catch(error){res.status(error.status||400).json({error:error.message||'Alpha Signal Engine request failed.'});}};}
alphaSignalRouter.post('/evaluate',protectedRoute(async(req,res)=>{
 const result=evaluateAlphaSignal(req.body||{}),existing=await readStoredEvents(10000,'alpha-signal-evaluation');
 if(!existing.some(e=>e.payload?.signalId===result.signalId))await persistEvent('alpha-signal-evaluation','jpti-alpha-signal-engine','signal_evaluated',result.signalId,result,result.generatedAt);
 res.json({...result,persisted:true,duplicateEvaluation:existing.some(e=>e.payload?.signalId===result.signalId)});
}));
alphaSignalRouter.post('/replay',protectedRoute(async(req,res)=>{
 const result=runAlphaReplay(req.body||{}),id=sha([result.data.sha256,result.parameters,result.timeframe].join('|'));
 await persistEvent('alpha-signal-replay','jpti-alpha-signal-engine','replay_completed',id,{id,...result},result.generatedAt);
 res.json({id,...result,persisted:true});
}));
alphaSignalRouter.get('/history',protectedRoute(async(_req,res)=>{
 const events=await readStoredEvents(500,'alpha-signal-evaluation');
 res.json({count:events.length,signals:events.map(e=>e.payload).reverse(),liveExecutionAuthorized:false});
}));
alphaSignalRouter.post('/paper/intent',protectedRoute(async(req,res)=>{
 const signalId=String(req.body?.signalId||'');if(!/^alpha_[a-f0-9]{32}$/.test(signalId))throw new Error('A valid evaluated Alpha signalId is required.');
 const signals=await readStoredEvents(10000,'alpha-signal-evaluation'),signal=signals.find(e=>e.payload?.signalId===signalId)?.payload;
 if(!signal)throw new Error('Signal not found in persisted evaluation history.');
 if(signal.decision!=='paper_intent_eligible'||!signal.permissions?.paperIntentEligible||signal.permissions?.liveExecutionAuthorized)throw new Error('Only a risk-approved paper-eligible signal can create a paper intent.');
 const intents=await readStoredEvents(10000,'alpha-paper-intent');
 const existing=intents.find(e=>e.payload?.signalId===signalId);
 if(existing){res.json({...existing.payload,duplicate:true,liveExecutionAuthorized:false});return;}
 if(Date.now()-Date.parse(signal.generatedAt)>60000)throw new Error('Signal has expired for paper entry. Generate a fresh assessment before creating a paper intent.');
 const intent={tradeId:randomUUID(),signalId,createdAt:new Date().toISOString(),status:'open',market:signal.market,direction:signal.direction,entry:signal.levels.entry,stopLoss:signal.levels.stopLoss,takeProfitOne:signal.levels.takeProfitOne,takeProfitTwo:signal.levels.takeProfitTwo,quantity:signal.sizing.quantity,notional:signal.sizing.notional,confidence:signal.confidence,engineVersion:signal.engineVersion,signalFingerprint:signal.evidence.signalFingerprint,liveExecutionAuthorized:false,exchangeOrdersCreated:0};
 await persistEvent('alpha-paper-intent','jpti-alpha-paper','paper_intent_opened',intent.tradeId,intent,intent.createdAt);
 res.status(201).json({...intent,persisted:true});
}));
alphaSignalRouter.post('/paper/mark',protectedRoute(async(req,res)=>{
 const tradeId=String(req.body?.tradeId||''),markPrice=Number(req.body?.markPrice),quoteTime=Date.parse(String(req.body?.quoteTimestamp||'')),now=Date.now(),quoteAgeMs=Number.isFinite(quoteTime)?now-quoteTime:null;
 if(!/^[0-9a-f-]{36}$/i.test(tradeId)||!Number.isFinite(markPrice)||markPrice<=0||quoteAgeMs===null||quoteAgeMs< -5000||quoteAgeMs>15000)throw new Error('Paper mark requires a valid trade, positive price and quote timestamp no older than 15 seconds.');
 const intents=await readStoredEvents(10000,'alpha-paper-intent'),intent=intents.find(e=>e.payload?.tradeId===tradeId)?.payload;
 if(!intent)throw new Error('Paper trade was not found.');
 const closes=await readStoredEvents(10000,'alpha-paper-close');
 if(closes.some(e=>e.payload?.tradeId===tradeId)){res.json({status:'closed',close:closes.find(e=>e.payload?.tradeId===tradeId).payload,duplicate:true});return;}
 const trigger=evaluatePaperExit(intent,markPrice);
 if(trigger){
  const feeBps=req.body?.feeBps==null?10:Number(req.body.feeBps),slippageBps=req.body?.slippageBps==null?5:Number(req.body.slippageBps);
  if(!Number.isFinite(feeBps)||feeBps<0||feeBps>100||!Number.isFinite(slippageBps)||slippageBps<0||slippageBps>100)throw new Error('Paper monitoring fee and slippage assumptions must be between 0 and 100 basis points.');
  const direction=intent.direction==='buy'?1:-1,exitPrice=markPrice*(direction===1?1-slippageBps/10000:1+slippageBps/10000),fees=exitPrice*intent.quantity*feeBps/10000,gross=(exitPrice-intent.entry)*intent.quantity*direction;
  const close={tradeId,signalId:intent.signalId,closedAt:new Date(now).toISOString(),exitPrice:round(exitPrice),markPrice:round(markPrice),fees:round(fees),grossPnl:round(gross,6),netPnl:round(gross-fees,6),returnPercent:round((gross-fees)/(intent.entry*intent.quantity)*100,4),reason:trigger,quoteTimestamp:new Date(quoteTime).toISOString(),liveExecutionAuthorized:false,exchangeOrdersCreated:0};
  await persistEvent('alpha-paper-close','jpti-alpha-paper','paper_trade_auto_closed',tradeId,close,close.closedAt);
  res.json({status:'closed',close,persisted:true,liveExecutionAuthorized:false});return;
 }
 const direction=intent.direction==='buy'?1:-1,unrealizedPnl=(markPrice-intent.entry)*intent.quantity*direction;
 const mark={tradeId,price:round(markPrice),quoteTimestamp:new Date(quoteTime).toISOString(),observedAt:new Date(now).toISOString(),quoteAgeMs,unrealizedPnl:round(unrealizedPnl,6),unrealizedReturnPercent:round(unrealizedPnl/(intent.entry*intent.quantity)*100,4),trigger:null};
 await persistEvent('alpha-paper-mark','jpti-alpha-paper','paper_trade_marked',tradeId+':'+quoteTime,mark,mark.observedAt);
 res.json({status:'open',mark,persisted:true,liveExecutionAuthorized:false});
}));
alphaSignalRouter.post('/paper/close',protectedRoute(async(req,res)=>{
 const tradeId=String(req.body?.tradeId||''),exitPrice=Number(req.body?.exitPrice);
 if(!/^[0-9a-f-]{36}$/i.test(tradeId)||!Number.isFinite(exitPrice)||exitPrice<=0)throw new Error('A valid paper tradeId and positive exitPrice are required.');
 const intents=await readStoredEvents(10000,'alpha-paper-intent'),intent=intents.find(e=>e.payload?.tradeId===tradeId)?.payload;
 if(!intent)throw new Error('Paper trade was not found.');
 const closes=await readStoredEvents(10000,'alpha-paper-close');
 if(closes.some(e=>e.payload?.tradeId===tradeId))throw new Error('Paper trade is already closed.');
 const fees=req.body?.fees==null?0:Number(req.body.fees);if(!Number.isFinite(fees)||fees<0||fees>intent.entry*intent.quantity*.1)throw new Error('Paper exit fees must be non-negative and no greater than 10% of entry notional.');
 const direction=intent.direction==='buy'?1:-1,gross=(exitPrice-intent.entry)*intent.quantity*direction,pnl=gross-fees;
 const close={tradeId,signalId:intent.signalId,closedAt:new Date().toISOString(),exitPrice:round(exitPrice),fees:round(fees),grossPnl:round(gross,6),netPnl:round(pnl,6),returnPercent:round(pnl/(intent.entry*intent.quantity)*100,4),reason:String(req.body?.reason||'operator_close').slice(0,80),liveExecutionAuthorized:false,exchangeOrdersCreated:0};
 await persistEvent('alpha-paper-close','jpti-alpha-paper','paper_trade_closed',tradeId,close,close.closedAt);
 res.json({...close,persisted:true});
}));
alphaSignalRouter.get('/paper/ledger',protectedRoute(async(_req,res)=>{
 const [intents,closes,marks]=await Promise.all([readStoredEvents(10000,'alpha-paper-intent'),readStoredEvents(10000,'alpha-paper-close'),readStoredEvents(20000,'alpha-paper-mark')]),closed=new Map(closes.map(e=>[e.payload.tradeId,e.payload])),latestMarks=new Map(marks.map(e=>[e.payload.tradeId,e.payload]));
 const trades=intents.map(e=>({...e.payload,mark:latestMarks.get(e.payload.tradeId)||null,close:closed.get(e.payload.tradeId)||null,status:closed.has(e.payload.tradeId)?'closed':'open'}));
 const realized=trades.filter(t=>t.close).reduce((s,t)=>s+t.close.netPnl,0);
 res.json({trades:trades.reverse(),summary:{total:trades.length,open:trades.filter(t=>t.status==='open').length,closed:closes.length,realizedPnl:round(realized,6),wins:trades.filter(t=>t.close?.netPnl>0).length,losses:trades.filter(t=>t.close?.netPnl<0).length},liveExecutionAuthorized:false});
}));
