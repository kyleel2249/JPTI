import React, { useCallback, useEffect, useState } from 'react';

const fmt = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined,{maximumFractionDigits:4});
const profilesFallback = [
  ['spot_trend','Spot trend'],['perp_momentum','Perpetual momentum'],['mean_reversion','Mean reversion'],
  ['breakout','Breakout'],['defi_rotation','DeFi rotation'],['meme_new_pair','New pair / meme'],
  ['equity_swing','Equity swing'],['macro_rotation','Macro rotation']
];

export default function UniversalEngine() {
  const [profiles,setProfiles]=useState([]);
  const [exchange,setExchange]=useState('binance');
  const [symbol,setSymbol]=useState('BTC/USDT');
  const [profileId,setProfileId]=useState('spot_trend');
  const [market,setMarket]=useState(null);
  const [evaluation,setEvaluation]=useState(null);
  const [query,setQuery]=useState('ETH');
  const [token,setToken]=useState('');
  const [dex,setDex]=useState(null);
  const [macro,setMacro]=useState(null);
  const [risk,setRisk]=useState(null);
  const [performance,setPerformance]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);

  useEffect(()=>{fetch('/api/universal/profiles').then(r=>r.json()).then(d=>setProfiles(Object.entries(d.profiles||{}).map(([id,p])=>({id,...p})))).catch(()=>setProfiles([]));},[]);

  const loadMarket=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const r=await fetch('/api/universal/market/'+encodeURIComponent(exchange)+'/'+encodeURIComponent(symbol)+'?timeframe=1h',{cache:'no-store'});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'Market evidence unavailable');
      setMarket(d);
      const ev=d.evidence||{};
      const payload={profileId,evidence:{momentumPct:ev.momentumPct,relativeVolume:ev.relativeVolume,timeframeAlignment:ev.momentumPct==null?null:Math.sign(ev.momentumPct),orderBookImbalance:ev.orderBookImbalance,fundingRate:ev.fundingRate,liquidityUsd:null}};
      const evalRes=await fetch('/api/universal/strategy/evaluate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const result=await evalRes.json();if(evalRes.ok)setEvaluation(result);
    }catch(e){setError(e.message);}finally{setLoading(false);}
  },[exchange,symbol,profileId]);

  const loadMacro=useCallback(async()=>{
    try{const r=await fetch('/api/universal/macro',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Macro sources unavailable');setMacro(d);}catch(e){setError(e.message);}
  },[]);
  const loadDex=useCallback(async(event)=>{
    if(event)event.preventDefault();setLoading(true);setError('');
    try{const r=await fetch('/api/universal/dex/search?q='+encodeURIComponent(query),{headers:{'x-jpti-api-token':token},cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'DEX search unavailable');setDex(d);}catch(e){setError(e.message);}finally{setLoading(false);}
  },[query,token]);
  const loadPrivate=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const headers={'x-jpti-api-token':token};
      const [r1,r2]=await Promise.all([fetch('/api/universal/risk',{headers,cache:'no-store'}),fetch('/api/universal/performance',{headers,cache:'no-store'})]);
      const [a,b]=await Promise.all([r1.json(),r2.json()]);
      if(!r1.ok)throw new Error(a.error||'Unified risk unavailable');if(!r2.ok)throw new Error(b.error||'Performance report unavailable');
      setRisk(a);setPerformance(b);
    }catch(e){setError(e.message);}finally{setLoading(false);}
  },[token]);

  useEffect(()=>{loadMacro();},[loadMacro]);

  const selected=profiles.find(p=>p.id===profileId);
  return <section className="glass-panel detail-workspace universal-engine">
    <span className="eyebrow">CROSS-ASSET INTELLIGENCE · UNIFIED RISK · STRATEGY RESEARCH</span>
    <h3>Universal trading intelligence engine</h3>
    <p>One evidence and strategy layer for crypto spot, perpetuals, DEX tokens, DeFi, equities and macro-sensitive markets. It evaluates data and risk; it does not automatically place orders.</p>
    <div className="risk-list">
      <p>• Six-agent T-Bots paper engine remains the DEX execution simulator.</p>
      <p>• Exchange capabilities, market hours, instrument rules and data coverage remain venue-specific.</p>
      <p>• Strategy scores are research evidence, not calibrated probabilities or guaranteed signals.</p>
    </div>

    <div className="section-heading"><div><span className="eyebrow">STRATEGY PROFILE REGISTRY</span><h3>Asset-class strategy selection</h3></div></div>
    <div className="news-search">
      <select value={profileId} onChange={e=>setProfileId(e.target.value)}>{(profiles.length?profiles:profilesFallback.map(([id,label])=>({id,label}))).map(p=><option key={p.id} value={p.id}>{p.label||p.id.replaceAll('_',' ')}</option>)}</select>
      <select value={exchange} onChange={e=>setExchange(e.target.value)}><option value="binance">Binance</option><option value="bitget">Bitget</option><option value="bybit">Bybit</option><option value="okx">OKX</option><option value="kraken">Kraken</option><option value="coinbase">Coinbase</option></select>
      <input value={symbol} onChange={e=>setSymbol(e.target.value)} placeholder="BASE/QUOTE"/>
      <button onClick={loadMarket} disabled={loading}>{loading?'Evaluating…':'Load market evidence'}</button>
    </div>
    {selected&&<p className="subtle-note">{selected.description||selected.horizon}. Supported asset classes: {(selected.assetClasses||[]).join(', ')}. Timeframes: {(selected.timeframes||[]).join(', ')}.</p>}
    {market&&<><div className="quote-consensus-stats">
      <div><span>LAST PRICE</span><b>{fmt(market.ticker?.last)}</b></div>
      <div><span>MOMENTUM WINDOW</span><b>{market.evidence?.momentumPct==null?'—':fmt(market.evidence.momentumPct)+'%'}</b></div>
      <div><span>RELATIVE VOLUME</span><b>{fmt(market.evidence?.relativeVolume)}x</b></div>
      <div><span>BOOK IMBALANCE</span><b>{market.evidence?.orderBookImbalance==null?'—':fmt(market.evidence.orderBookImbalance*100)+'%'}</b></div>
    </div>
    <div className="risk-list">{(market.council?.agents||[]).map(a=><p key={a.id}><b>{a.specialty||a.id}</b> · {a.bias||a.position||'insufficient data'} · {a.reason||a.note||''}</p>)}</div>
    <p className="subtle-note">{(market.limitations||[]).join(' ')}</p></>}
    {evaluation&&<div className="quote-consensus-stats"><div><span>PROFILE SCORE</span><b>{evaluation.score}/100</b></div><div><span>BIAS</span><b>{evaluation.bias}</b></div><div><span>STATUS</span><b>{evaluation.status.replaceAll('_',' ')}</b></div><div><span>MISSING EVIDENCE</span><b>{evaluation.missingEvidence.join(', ')||'None'}</b></div></div>}

    <div className="section-heading"><div><span className="eyebrow">MULTI-CHAIN TOKEN DISCOVERY</span><h3>DEX asset universe</h3></div></div>
    <form className="news-search" onSubmit={loadDex}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Token name, symbol or contract"/><input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="JPTI API token"/><button disabled={loading||!token||query.trim().length<2}>{loading?'Searching…':'Search DEX universe'}</button></form>
    {dex&&<><div className="quote-consensus-stats"><div><span>PAIR RESULTS</span><b>{dex.pairs?.length||0}</b></div><div><span>CHAINS</span><b>{(dex.chains||[]).join(', ')||'—'}</b></div><div><span>DATA SOURCE</span><b>{dex.source}</b></div><div><span>UPDATED</span><b>{new Date(dex.fetchedAt).toLocaleTimeString()}</b></div></div>
    <div className="scanner-table"><div><span>CHAIN / PAIR</span><span>PRICE USD</span><span>LIQUIDITY</span><span>24H VOLUME</span><span>EVIDENCE</span></div>{(dex.pairs||[]).slice(0,30).map((p,i)=><div key={p.chain+':'+p.pairAddress+':'+i}><b>{p.chain} · {p.base?.symbol}/{p.quote?.symbol}</b><span>{fmt(p.priceUsd)}</span><span>{fmt(p.liquidityUsd)}</span><span>{fmt(p.volume24hUsd)}</span><strong>{p.evidence?.score??'—'}/100</strong></div>)}</div>
    <p className="subtle-note">{dex.coverage}</p></>}

    <div className="section-heading"><div><span className="eyebrow">GLOBAL REGIME</span><h3>Crypto, DeFi & macro context</h3></div><button className="refresh-button" onClick={loadMacro}>Refresh macro</button></div>
    {macro&&<><div className="quote-consensus-stats"><div><span>CRYPTO MARKET CAP</span><b>{fmt(macro.crypto?.marketCapUsd)}</b></div><div><span>BTC DOMINANCE</span><b>{fmt(macro.crypto?.btcDominancePercent)}%</b></div><div><span>DEFI TVL</span><b>{fmt(macro.defi?.totalValueLockedUsd)}</b></div><div><span>FED FUNDS</span><b>{fmt(macro.macro?.fedFundsLatest)}%</b></div></div>
    <p className="subtle-note">Sources: {Object.entries(macro.sources||{}).map(([k,v])=>k+': '+v.status).join(' · ')}. Missing providers remain unavailable, not zero.</p></>}

    <div className="section-heading"><div><span className="eyebrow">PORTFOLIO-WIDE CONTROL</span><h3>Unified risk & performance</h3></div></div>
    <div className="news-search"><input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="JPTI API token"/><button onClick={loadPrivate} disabled={loading||!token}>{loading?'Loading…':'Load unified risk & performance'}</button></div>
    {risk&&<><div className="quote-consensus-stats"><div><span>NEW ENTRIES</span><b>{risk.newEntriesAllowed?'ALLOWED':'PAUSED'}</b></div><div><span>LOSS STREAK</span><b>{risk.consecutiveLosses}</b></div><div><span>24H USD LOSS</span><b>{fmt(risk.rolling24hUsdLoss)}</b></div><div><span>DAILY LIMIT</span><b>{fmt(risk.maxDailyLossUsd)}</b></div></div><p className="subtle-note">{(risk.pauseReasons||[]).join(' · ')||'No configured shared pause condition currently breached'}. Existing exits remain enabled. {risk.caveat}</p></>}
    {performance&&<><div className="quote-consensus-stats"><div><span>T-BOTS CLOSED PAPER TRADES</span><b>{performance.paperStrategy.closedTrades}</b></div><div><span>PAPER WIN RATE</span><b>{performance.paperStrategy.winRatePercent==null?'—':fmt(performance.paperStrategy.winRatePercent)+'%'}</b></div><div><span>PAPER REALIZED PNL</span><b>{fmt(performance.paperStrategy.realizedPnlUsd)} USD</b></div><div><span>EXCHANGE FILLS</span><b>{performance.exchangeExecution.fillCount}</b></div></div><p className="subtle-note">{performance.caveat}</p></>}
    {error&&<p className="quote-error">{error}</p>}
  </section>;
}
