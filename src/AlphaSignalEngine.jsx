import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Clock3, FlaskConical, Play, RefreshCw, ShieldCheck, Target, TrendingUp, XCircle } from 'lucide-react';
import { apiFetch } from './lib/api.js';
import './AlphaSignalEngine.css';

const fmt=(v,d=4)=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString(undefined,{maximumFractionDigits:d});
const options={exchange:['binance','bitget','bybit','okx'],timeframe:['5m','15m','1h','4h','1d']};
export default function AlphaSignalEngine(){
 const [exchange,setExchange]=useState('binance'),[symbol,setSymbol]=useState('BTC/USDT'),[timeframe,setTimeframe]=useState('1h');
 const [equity,setEquity]=useState('10000'),[dailyPnl,setDailyPnl]=useState('0'),[riskPercent,setRiskPercent]=useState('0.5'),[maxNotional,setMaxNotional]=useState('2000'),[apiToken,setApiToken]=useState(''),[inventoryConfirmed,setInventoryConfirmed]=useState(false),[exposuresJson,setExposuresJson]=useState('');
 const [result,setResult]=useState(null),[replay,setReplay]=useState(null),[ledger,setLedger]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[paperBusy,setPaperBusy]=useState(false);
 const headers=()=>apiToken?{'x-jpti-api-token':apiToken}:{};
 const loadLedger=useCallback(async()=>{try{const r=await apiFetch('/api/alpha/paper/ledger',{headers:headers(),cache:'no-store'});const d=await r.json();if(r.ok)setLedger(d);}catch{}},[apiToken]);
 useEffect(()=>{loadLedger();},[loadLedger]);
 const getMarketData=useCallback(async()=>{
  const normalized=symbol.trim().toUpperCase();if(!/^[A-Z0-9._-]{2,20}\/[A-Z0-9._-]{2,20}$/.test(normalized))throw new Error('Enter a normalized BASE/QUOTE symbol such as BTC/USDT.');
  const marketPath=normalized.replace('/','-');
  const [candleResponse,quoteResponse]=await Promise.all([
   apiFetch('/api/exchanges/'+exchange+'/ohlcv/'+encodeURIComponent(marketPath)+'?timeframe='+encodeURIComponent(timeframe)+'&limit=320',{cache:'no-store'}),
   apiFetch('/api/exchanges/'+exchange+'/ticker/'+encodeURIComponent(marketPath),{cache:'no-store'})
  ]);
  const [candleData,quoteData]=await Promise.all([candleResponse.json(),quoteResponse.json()]);
  if(!candleResponse.ok)throw new Error(candleData.error||'OHLCV history unavailable.');
  if(!quoteResponse.ok)throw new Error(quoteData.error||'A fresh exchange quote is required.');
  const timestamp=quoteData.timestamp?new Date(quoteData.timestamp).toISOString():quoteData.datetime;
  return {symbol:normalized,candles:candleData.candles,quote:{last:quoteData.last,timestamp}};
 },[exchange,symbol,timeframe]);
 const run=useCallback(async()=>{
  setBusy(true);setError('');setReplay(null);
  try{let exposures;try{exposures=JSON.parse(exposuresJson);}catch{throw new Error('Existing exposure inventory must be valid JSON. Enter [] only after confirming that the account has no open positions.');}if(!Array.isArray(exposures))throw new Error('Existing exposure inventory must be a JSON array.');if(!inventoryConfirmed)throw new Error('Confirm that the exposure inventory includes every current open position before requesting paper eligibility.');const market=await getMarketData();const payload={...market,exchange,timeframe,account:{equity:Number(equity),dailyPnl:Number(dailyPnl),exposures},
   limits:{maxDailyLoss:Math.max(1,Number(equity)*.025),maxOrderNotional:Number(maxNotional),maxGrossExposure:Math.max(Number(maxNotional),Number(equity)*.5),maxRiskPercent:Number(riskPercent),maxSymbolConcentrationPercent:25,maxQuoteAgeMs:15000},
   config:{riskPercent:Number(riskPercent),minimumConfidence:62,minimumAgreement:.5,atrStopMultiple:1.5,targetOneR:1,targetTwoR:2}};
   const response=await apiFetch('/api/alpha/evaluate',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Alpha analysis failed.');setResult(data);await loadLedger();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 },[getMarketData,equity,dailyPnl,maxNotional,riskPercent,apiToken,exchange,timeframe,loadLedger,inventoryConfirmed,exposuresJson]);
 const createPaper=useCallback(async()=>{
  if(!result?.signalId)return;setPaperBusy(true);setError('');
  try{const r=await apiFetch('/api/alpha/paper/intent',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({signalId:result.signalId})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Paper intent rejected.');await loadLedger();}catch(e){setError(e.message);}finally{setPaperBusy(false);}
 },[result,apiToken,loadLedger]);
 const runReplay=useCallback(async()=>{
  setBusy(true);setError('');
  try{const market=await getMarketData();const r=await apiFetch('/api/alpha/replay',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({candles:market.candles,timeframe,config:{riskPercent:Number(riskPercent),minimumConfidence:62,minimumAgreement:.5,atrStopMultiple:1.5,targetOneR:1,targetTwoR:2},feeBps:10,slippageBps:5,initialCapital:Number(equity)})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Historical replay failed.');setReplay(d);}catch(e){setError(e.message);}finally{setBusy(false);}
 },[getMarketData,timeframe,riskPercent,equity,apiToken]);
 const closePaper=async trade=>{const price=window.prompt('Enter the observed exit price for this paper-only position:');if(!price)return;try{const r=await apiFetch('/api/alpha/paper/close',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({tradeId:trade.tradeId,exitPrice:Number(price),reason:'operator_close'})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not close paper position.');await loadLedger();}catch(e){setError(e.message);}};
 const side=result?.direction,eligible=result?.permissions?.paperIntentEligible;
 return <div className="alpha-workspace">
  <section className="alpha-hero"><div><span className="alpha-eyebrow"><Activity size={13}/> JPTI QUANTITATIVE RESEARCH / ENGINE v1.0</span><h2>Alpha Signal Engine</h2><p>Deterministic multi-model signals, explainable evidence, reproducible fingerprints and fail-closed paper risk assessment.</p></div><div className="alpha-lock"><ShieldCheck size={17}/><span>PAPER ONLY<br/><b>LIVE EXECUTION LOCKED</b></span></div></section>
  <section className="alpha-panel"><div className="alpha-section-head"><div><span className="alpha-eyebrow">01 / MARKET & RISK CONFIGURATION</span><h3>Signal assessment parameters</h3></div><span className="alpha-chip">COMPLETED CANDLES ONLY</span></div>
   <div className="alpha-controls">
    <label>Exchange<select value={exchange} onChange={e=>setExchange(e.target.value)}>{options.exchange.map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Market symbol<input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} placeholder="BTC/USDT"/></label>
    <label>Timeframe<select value={timeframe} onChange={e=>setTimeframe(e.target.value)}>{options.timeframe.map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Account equity<input type="number" min="1" value={equity} onChange={e=>setEquity(e.target.value)}/></label>
    <label>Daily realized PnL<input type="number" value={dailyPnl} onChange={e=>setDailyPnl(e.target.value)}/></label>
    <label>Risk per trade (%)<input type="number" min="0.1" max="2" step="0.1" value={riskPercent} onChange={e=>setRiskPercent(e.target.value)}/></label>
    <label>Max order notional<input type="number" min="1" value={maxNotional} onChange={e=>setMaxNotional(e.target.value)}/></label>
    <label>Existing exposures JSON<input value={exposuresJson} onChange={e=>{setExposuresJson(e.target.value);setInventoryConfirmed(false);}} placeholder='[{"symbol":"BTC/USDT","marketValue":500}] or [] if flat'/></label><label>API token (if required)<input type="password" value={apiToken} onChange={e=>setApiToken(e.target.value)} placeholder="Local private access may not require one" autoComplete="off"/></label>
   </div>
   <label className="alpha-confirm"><input type="checkbox" checked={inventoryConfirmed} onChange={e=>setInventoryConfirmed(e.target.checked)}/> I confirm this inventory is complete and current, including all open positions.</label><div className="alpha-actions"><button className="alpha-primary" onClick={run} disabled={busy||!inventoryConfirmed}>{busy?<RefreshCw className="spin" size={15}/>:<Play size={15}/>} {busy?'Analyzing market…':'Generate Alpha assessment'}</button><button className="alpha-secondary" onClick={runReplay} disabled={busy}><FlaskConical size={15}/> Replay historical signals</button></div>
   <p className="alpha-footnote">Uses public OHLCV and ticker data from the selected exchange. Risk inventory is explicitly empty in this initial UI; connect a reconciled account exposure feed before using paper eligibility with an existing portfolio.</p>
   {error&&<div className="alpha-error"><AlertTriangle size={15}/>{error}</div>}
  </section>
  {result&&<section className="alpha-panel"><div className="alpha-section-head"><div><span className="alpha-eyebrow">02 / EXPLAINABLE SIGNAL OUTPUT</span><h3>Assessment result</h3></div><span className={'alpha-status '+(eligible?'pass':'blocked')}>{eligible?'PAPER ELIGIBLE':'BLOCKED'}</span></div>
   <div className="alpha-result-grid"><div className="alpha-direction"><span>ENSEMBLE DIRECTION</span><b className={side==='buy'?'up':side==='sell'?'down':''}>{side==='buy'?'BUY':side==='sell'?'SELL':'NEUTRAL'}</b><small>{result.market.symbol} · {result.market.timeframe} · {result.market.exchange}</small></div>
    <div className="alpha-metric"><span>HEURISTIC CONFIDENCE</span><b>{fmt(result.confidence,1)}%</b><small>Not a calibrated win probability</small></div><div className="alpha-metric"><span>MODEL AGREEMENT</span><b>{fmt(result.modelAgreement*100,1)}%</b><small>Active directional models</small></div><div className="alpha-metric"><span>MARKET REGIME</span><b>{result.marketRegime.replaceAll('_',' ')}</b><small>{result.market.completedCandles} completed bars</small></div></div>
   <div className="alpha-levels"><div><span>REFERENCE ENTRY</span><b>{fmt(result.levels.entry)}</b></div><div><span>STOP LOSS</span><b className="down">{fmt(result.levels.stopLoss)}</b></div><div><span>TAKE PROFIT 1</span><b className="up">{fmt(result.levels.takeProfitOne)}</b></div><div><span>TAKE PROFIT 2</span><b className="up">{fmt(result.levels.takeProfitTwo)}</b></div><div><span>RISK BUDGET</span><b>{fmt(result.sizing.riskBudget)}</b></div><div><span>PROPOSED QUANTITY</span><b>{fmt(result.sizing.quantity,6)}</b></div></div>
   <h4>Specialist evidence</h4><div className="alpha-models">{result.evidence.models.map(m=><article key={m.id}><div><b>{m.label}</b><span className={m.direction===1?'up':m.direction===-1?'down':''}>{m.direction===1?'BULLISH':m.direction===-1?'BEARISH':'NEUTRAL'} · {Math.round(m.weight*100)}%</span></div><p>{m.evidence}</p></article>)}</div>
   <h4>Quality and risk gates</h4><div className="alpha-checks">{[...result.qualityChecks,...result.riskChecks].map(c=><div key={c.id}><span>{c.passed?<CheckCircle2 className="up" size={15}/>:<XCircle className="down" size={15}/>}<b>{c.id.replaceAll('_',' ')}</b></span><small>{c.detail}</small></div>)}</div>
   <div className="alpha-actions"><button className="alpha-primary" disabled={!eligible||paperBusy} onClick={createPaper}>{paperBusy?'Recording…': 'Create paper-only intent'}</button><span className="alpha-footnote">Signal fingerprint · {result.evidence.signalFingerprint.slice(0,24)}…</span></div>
   <p className="alpha-footnote">{result.evidence.methodology} Live execution authorized: no. Exchange orders created: 0.</p>
  </section>}
  {replay&&<section className="alpha-panel"><div className="alpha-section-head"><div><span className="alpha-eyebrow">03 / HISTORICAL REPRODUCIBILITY</span><h3>Deterministic replay results</h3></div><span className="alpha-chip">70 / 30 CHRONOLOGICAL SPLIT</span></div>
   <div className="alpha-result-grid">{[['TRADES',replay.overall.trades],['WIN RATE',replay.overall.winRatePercent==null?'—':replay.overall.winRatePercent+'%'],['PROFIT FACTOR',fmt(replay.overall.profitFactor,2)],['NET P&L',fmt(replay.overall.netPnl)],['MAX DRAWDOWN',replay.overall.maxDrawdownPercent+'%'],['OOS NET P&L',fmt(replay.outOfSample.netPnl)]].map(([k,v])=><div className="alpha-metric" key={k}><span>{k}</span><b>{v}</b></div>)}</div><p className="alpha-footnote">Dataset SHA-256 · {replay.data.sha256}. Out-of-sample parameters were not selected using test data. Fees, slippage and conservative stop-first intrabar assumptions are applied.</p>
  </section>}
  <section className="alpha-panel"><div className="alpha-section-head"><div><span className="alpha-eyebrow">04 / PAPER EXECUTION TRACKER</span><h3>Paper trade ledger</h3></div><button className="alpha-secondary" onClick={loadLedger}><RefreshCw size={14}/> Refresh</button></div>
   <div className="alpha-result-grid"><div className="alpha-metric"><span>OPEN</span><b>{ledger?.summary?.open??'—'}</b></div><div className="alpha-metric"><span>CLOSED</span><b>{ledger?.summary?.closed??'—'}</b></div><div className="alpha-metric"><span>REALIZED P&L</span><b>{fmt(ledger?.summary?.realizedPnl)}</b></div><div className="alpha-metric"><span>WIN / LOSS</span><b>{(ledger?.summary?.wins??0)+' / '+(ledger?.summary?.losses??0)}</b></div></div>
   <div className="alpha-table"><div><span>MARKET</span><span>DIRECTION</span><span>ENTRY</span><span>STOP / TARGET</span><span>STATUS</span><span>ACTION</span></div>{(ledger?.trades||[]).map(t=><div key={t.tradeId}><b>{t.market.symbol}</b><span>{t.direction.toUpperCase()}</span><span>{fmt(t.entry)}</span><span>{fmt(t.stopLoss)} / {fmt(t.takeProfitTwo)}</span><span>{t.status}</span><span>{t.status==='open'?<button onClick={()=>closePaper(t)}>Record exit</button>:fmt(t.close.netPnl)}</span></div>)}{!ledger?.trades?.length&&<p className="alpha-empty">No paper trades recorded yet.</p>}</div>
   <p className="alpha-footnote">Paper ledger entries are locally persisted events. Exit prices are manually recorded in this release; no exchange orders are submitted.</p>
  </section>
 </div>;
}
