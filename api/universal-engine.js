import express from 'express';
import { withExchange } from './exchanges.js';
import { requirePrivateApiAuth } from './policy.js';
import { getLedgerTransactions } from './operations.js';
import { buildEvidenceCouncil } from './advanced-intelligence.js';
import { normalizeDexPair, scoreAssetEvidence, summarizeBotMemory } from './multi-asset-intelligence.js';

export const universalRouter = express.Router();
const finite = v => Number.isFinite(Number(v)) ? Number(v) : null;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const stableQuotes = new Set(['USD','USDT','USDC','DAI','FDUSD','USDP','TUSD']);

export const STRATEGY_PROFILES = Object.freeze({
  spot_trend: { assetClasses:['crypto_spot','token'], timeframes:['15m','1h','4h','1d'], horizon:'intraday-to-swing', leverageAllowed:false, description:'Trend continuation with volume and multi-timeframe confirmation.' },
  perp_momentum: { assetClasses:['crypto_perpetual','crypto_future'], timeframes:['5m','15m','1h','4h'], horizon:'intraday', leverageAllowed:true, maxSuggestedLeverage:2, description:'Funding-aware momentum with volatility and liquidation-risk filters.' },
  mean_reversion: { assetClasses:['crypto_spot','crypto_perpetual','equity','fx'], timeframes:['5m','15m','1h','4h'], horizon:'intraday', leverageAllowed:false, description:'Range/volatility reversion; disabled in strong trend or thin liquidity.' },
  breakout: { assetClasses:['crypto_spot','token','equity','commodity'], timeframes:['15m','1h','4h','1d'], horizon:'swing', leverageAllowed:false, description:'Range breakout confirmed by relative volume and retest.' },
  defi_rotation: { assetClasses:['defi_token','defi_protocol'], timeframes:['1h','4h','1d','1w'], horizon:'swing', leverageAllowed:false, description:'Relative strength combined with TVL, fees and protocol-risk evidence.' },
  meme_new_pair: { assetClasses:['meme_token','new_pair'], timeframes:['1m','5m','15m'], horizon:'very_short', leverageAllowed:false, description:'New-pair momentum subject to strict contract, liquidity and holder checks.' },
  equity_swing: { assetClasses:['equity','etf'], timeframes:['1h','4h','1d','1w'], horizon:'swing', leverageAllowed:false, description:'Equity trend and volatility framework; corporate actions and venue hours required.' },
  macro_rotation: { assetClasses:['fx','commodity','index','bond'], timeframes:['4h','1d','1w'], horizon:'swing-to-position', leverageAllowed:false, description:'Macro regime and cross-asset relative-strength framework; provider coverage required.' }
});

export function classifyInstrument({ market = {}, chain = null, pair = null } = {}) {
  if (pair || chain) return { assetClass: 'token', instrumentType: 'dex_pair', chain: chain || null };
  if (market.option) return { assetClass: 'derivative_option', instrumentType: 'option' };
  if (market.swap) return { assetClass: 'crypto_perpetual', instrumentType: 'perpetual_swap' };
  if (market.future) return { assetClass: 'crypto_future', instrumentType: 'future' };
  if (market.spot) return { assetClass: 'crypto_spot', instrumentType: 'spot' };
  return { assetClass: market.type || 'unknown', instrumentType: market.type || 'unknown' };
}

export function evaluateStrategyProfile(profileId, evidence = {}) {
  const profile = STRATEGY_PROFILES[profileId];
  if (!profile) throw new Error('Unknown strategy profile.');
  const missing = [];
  const signals = [];
  const momentum = finite(evidence.momentumPct);
  const volume = finite(evidence.relativeVolume);
  const rsi = finite(evidence.rsi14);
  const alignment = finite(evidence.timeframeAlignment);
  const imbalance = finite(evidence.orderBookImbalance);
  const funding = finite(evidence.fundingRate);
  const liquidity = finite(evidence.liquidityUsd);
  if (momentum === null) missing.push('momentum');
  else signals.push({ factor:'momentum', bias: momentum > 0 ? 'bullish' : momentum < 0 ? 'bearish' : 'neutral', value:momentum });
  if (volume === null) missing.push('relative_volume');
  else signals.push({ factor:'relative_volume', bias:volume >= 1.5 ? 'confirming' : 'weak', value:volume });
  if (alignment === null) missing.push('timeframe_alignment');
  else signals.push({ factor:'timeframe_alignment', bias:alignment > 0 ? 'bullish' : alignment < 0 ? 'bearish' : 'mixed', value:alignment });
  if (imbalance !== null) signals.push({ factor:'order_book', bias:imbalance > .15 ? 'bullish' : imbalance < -.15 ? 'bearish' : 'balanced', value:imbalance });
  if (funding !== null) signals.push({ factor:'funding', bias:Math.abs(funding) > .001 ? 'crowded' : 'normal', value:funding });
  let score = 50 + clamp(momentum ?? 0,-10,10)*1.5 + clamp((volume ?? 1)-1,-2,3)*5 + clamp(alignment ?? 0,-1,1)*12 + clamp(imbalance ?? 0,-1,1)*8;
  if (profileId === 'mean_reversion' && rsi !== null) score += rsi < 30 ? 12 : rsi > 70 ? -12 : 0;
  if (profileId === 'perp_momentum' && funding !== null) score -= clamp(Math.abs(funding)*10000,0,15);
  if (liquidity !== null && liquidity < 10000) score -= 20;
  score = Math.round(clamp(score,0,100));
  const conflict = signals.filter(s => ['bullish','bearish'].includes(s.bias)).some((s,i,arr) => arr.some(t => t.bias !== s.bias));
  const ready = missing.length <= 1 && liquidity !== null && liquidity >= 10000 && !conflict;
  return { profileId, profile, score, bias:score >= 60 ? 'bullish' : score <= 40 ? 'bearish' : 'neutral',
    status:!ready ? 'insufficient_or_conflicting_evidence' : score >= 65 ? 'research_candidate' : 'monitor',
    signals, missingEvidence:missing, conflicts:conflict, leveragePolicy:profile.leverageAllowed ? 'exchange and account risk limits still required; profile maximum is not an authorization' : 'no leverage',
    decision:'research-only; not an order instruction' };
}

export function calculateUnifiedRisk(events, options = {}) {
  const now = options.now ?? Date.now();
  const maxConsecutiveLosses = clamp(Number(options.maxConsecutiveLosses ?? 3),1,20);
  const maxDailyLossUsd = Math.max(0, Number(options.maxDailyLossUsd ?? 100));
  const botEvents = events.filter(e => e.source === 'tbots' && e.eventType === 'bot_trade' && e.metadata?.action === 'paper_closed')
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
  const closed = botEvents.map(e=>({ at:e.occurredAt, pnl:finite(e.metadata?.pnl), source:'tbots-paper', quote:'USD' })).filter(e=>e.pnl!==null);
  const dayAgo = now - 86400000;
  const recent = closed.filter(e=>Date.parse(e.at)>=dayAgo);
  let streak=0;
  for(const trade of [...closed].reverse()){if(trade.pnl<0)streak++;else break;}
  const dailyByQuote = {};
  for(const trade of recent) dailyByQuote[trade.quote]=(dailyByQuote[trade.quote]||0)+trade.pnl;
  const usdLoss = Math.max(0,-(dailyByQuote.USD||0));
  const reasons=[];
  if(streak>=maxConsecutiveLosses) reasons.push('consecutive_paper_loss_limit');
  if(maxDailyLossUsd>0 && usdLoss>=maxDailyLossUsd) reasons.push('daily_usd_loss_limit');
  return { generatedAt:new Date(now).toISOString(), newEntriesAllowed:reasons.length===0, pauseReasons:reasons,
    consecutiveLosses:streak, maxConsecutiveLosses, rolling24hRealizedPnlByQuote:dailyByQuote,
    maxDailyLossUsd, rolling24hUsdLoss:usdLoss,
    sources:{tbotsPaperClosedTrades:closed.length, jptiExchangeFillHistory:'not yet incorporated into unified realized-PnL guard'},
    exitsRemainEnabled:true, mode:'paper-first',
    caveat:'This first unified guard computes T-Bots closed paper PnL. Exchange fills are exposed in the unified performance report but are not silently converted or combined across currencies without FX marks.' };
}

export function buildUnifiedPerformance(events) {
  const trades = events.filter(e=>e.source==='tbots' && e.eventType==='bot_trade' && e.metadata?.action==='paper_closed');
  const pnl = trades.map(e=>finite(e.metadata?.pnl)).filter(v=>v!==null);
  const wins=pnl.filter(v=>v>0).length;
  const bySymbol={};
  for(const e of trades){const key=e.symbol||'unknown';const v=finite(e.metadata?.pnl);if(v===null)continue;const row=bySymbol[key]||(bySymbol[key]={trades:0,pnl:0,wins:0});row.trades++;row.pnl+=v;if(v>0)row.wins++;}
  const fills=events.filter(e=>e.eventType==='fill');
  const byVenue={};
  for(const e of fills){const row=byVenue[e.source]||(byVenue[e.source]={fills:0,buyQty:0,sellQty:0,feesByCurrency:{}});row.fills++;if(e.side==='buy')row.buyQty+=e.quantity||0;if(e.side==='sell')row.sellQty+=e.quantity||0;if(e.feeCurrency)row.feesByCurrency[e.feeCurrency]=(row.feesByCurrency[e.feeCurrency]||0)+(e.fee||0);}
  return {generatedAt:new Date().toISOString(),paperStrategy:{closedTrades:pnl.length,wins,losses:pnl.length-wins,winRatePercent:pnl.length?wins/pnl.length*100:null,realizedPnlUsd:pnl.reduce((a,b)=>a+b,0),bySymbol},
    exchangeExecution:{fillCount:fills.length,byVenue,realizedPnl:'not computed here; use lot-based portfolio accounting and preserve quote currencies'},
    attributionDimensions:['asset/pair','venue','paper-vs-exchange','strategy profile when tagged','session'],
    caveat:'No untagged trade is assigned to a strategy. Exchange fills are activity records, not automatically equivalent to closed trades.'};
}

universalRouter.get('/universal/profiles',(req,res)=>res.json({profiles:STRATEGY_PROFILES,assetClasses:[...new Set(Object.values(STRATEGY_PROFILES).flatMap(p=>p.assetClasses))]}));

universalRouter.post('/universal/strategy/evaluate',(req,res)=>{
  try{res.json(evaluateStrategyProfile(String(req.body?.profileId||''),req.body?.evidence||{}));}
  catch(e){res.status(400).json({error:e.message});}
});

universalRouter.get('/universal/market/:exchange/:symbol',async(req,res)=>{
  try{
    const exchangeId=String(req.params.exchange).toLowerCase(),symbol=String(req.params.symbol).toUpperCase().replace('-','/');
    const timeframe=String(req.query.timeframe||'1h');
    const data=await withExchange(exchangeId,{privateAccess:false},async ex=>{
      const market=ex.markets[symbol];
      if(!market)throw Object.assign(new Error('Market is not listed on this venue.'),{status:404});
      const tasks={};
      if(ex.has?.fetchTicker)tasks.ticker=ex.fetchTicker(symbol).catch(()=>null);
      if(ex.has?.fetchOHLCV && (!ex.timeframes||ex.timeframes[timeframe]))tasks.candles=ex.fetchOHLCV(symbol,timeframe,undefined,120).catch(()=>null);
      if(ex.has?.fetchOrderBook)tasks.orderBook=ex.fetchOrderBook(symbol,25).catch(()=>null);
      if(market.contract && ex.has?.fetchFundingRate)tasks.funding=ex.fetchFundingRate(symbol).catch(()=>null);
      if(market.contract && ex.has?.fetchOpenInterest)tasks.openInterest=ex.fetchOpenInterest(symbol).catch(()=>null);
      const values=await Promise.all(Object.entries(tasks).map(async([k,p])=>[k,await p]));
      return {market:{symbol,base:market.base,quote:market.quote,spot:market.spot,contract:market.contract,swap:market.swap,future:market.future},...Object.fromEntries(values)};
    });
    const closes=(data.candles||[]).map(c=>finite(c[4])).filter(v=>v>0);
    const momentumPct=closes.length>1?(closes.at(-1)/closes[0]-1)*100:null;
    const volumes=(data.candles||[]).slice(-20).map(c=>finite(c[5])).filter(v=>v!==null);
    const avgVol=volumes.length?volumes.reduce((a,b)=>a+b,0)/volumes.length:null;
    const relVol=volumes.length>1&&avgVol>0?volumes.at(-1)/avgVol:null;
    const bids=data.orderBook?.bids||[],asks=data.orderBook?.asks||[];
    const bd=bids.slice(0,10).reduce((s,x)=>s+x[0]*x[1],0),ad=asks.slice(0,10).reduce((s,x)=>s+x[0]*x[1],0);
    const imbalance=bd+ad?(bd-ad)/(bd+ad):null;
    const evidence={momentumPct,relativeVolume:relVol,orderBookImbalance:imbalance,fundingRate:finite(data.funding?.fundingRate),openInterest:data.openInterest||null};
    const council=buildEvidenceCouncil({priceChangePct:momentumPct,volumeChangePct:relVol===null?null:(relVol-1)*100,depthImbalance:imbalance,fundingRate:evidence.fundingRate,openInterestChangePct:null});
    res.set('Cache-Control','no-store');
    res.json({exchange:exchangeId,market:data.market,timeframe,fetchedAt:new Date().toISOString(),
      sources:{exchange:{status:'live',capabilities:{ticker:Boolean(data.ticker),candles:Boolean(data.candles),orderBook:Boolean(data.orderBook),funding:Boolean(data.funding),openInterest:Boolean(data.openInterest)}}},
      ticker:data.ticker?{last:data.ticker.last,bid:data.ticker.bid,ask:data.ticker.ask,quoteVolume:data.ticker.quoteVolume,timestamp:data.ticker.timestamp}:null,
      evidence,council,availableStrategyProfiles:Object.keys(STRATEGY_PROFILES).filter(id=>STRATEGY_PROFILES[id].assetClasses.includes(data.market.spot?'crypto_spot':data.market.swap?'crypto_perpetual':data.market.future?'crypto_future':'unknown')),
      limitations:['CEX venue evidence only; on-chain, macro and news feeds must be independently configured and are not inferred from a ticker.','No order is placed.']});
  }catch(e){res.status(e.status||502).json({error:e.message});}
});

universalRouter.get('/universal/dex/search',async(req,res)=>{
  try{
    requirePrivateApiAuth(req);
    const q=String(req.query.q||'').trim().slice(0,80);
    if(q.length<2)return res.status(400).json({error:'Search query must be at least two characters.'});
    const response=await fetch('https://api.dexscreener.com/latest/dex/search?q='+encodeURIComponent(q),{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('DEX Screener HTTP '+response.status);
    const body=await response.json();
    const pairs=(body.pairs||[]).slice(0,100).map(normalizeDexPair).map(p=>({...p,evidence:scoreAssetEvidence(p)}));
    res.set('Cache-Control','no-store').json({query:q,source:'DexScreener',fetchedAt:new Date().toISOString(),pairs,chains:[...new Set(pairs.map(p=>p.chain))],coverage:'Provider search results, not exhaustive token registry.'});
  }catch(e){res.status(e.status||502).json({error:e.message});}
});


universalRouter.post('/universal/asset-evidence',(req,res)=>{
  try { requirePrivateApiAuth(req); } catch (error) { return res.status(error.status || 401).json({ error: error.message }); }
  const items=req.body?.assets;
  if(!Array.isArray(items)||items.length>80)return res.status(400).json({error:'assets must be an array of at most 80 token observations.'});
  const evidence=items.map(item=>{
    const asset={chain:String(item.chain||'unknown').toLowerCase(),base:{address:item.address||null,symbol:item.symbol||null},quote:{address:item.quoteAddress||null,symbol:item.quoteSymbol||null},
      liquidityUsd:finite(item.liquidityUsd)??0,volume24hUsd:finite(item.volume24hUsd)??0,volume1hUsd:finite(item.volume1hUsd)??0,
      priceChange1hPercent:finite(item.change1hPct),txns:{h1:{buys:finite(item.buys)??0,sells:finite(item.sells)??0}},ageHours:finite(item.ageMin)===null?null:Number(item.ageMin)/60};
    const score=scoreAssetEvidence(asset);
    return {id:String(item.id||item.chain+':'+item.address),chain:asset.chain,address:asset.base.address,symbol:asset.base.symbol,
      score:score.score,verdict:score.verdict,warnings:score.warnings,components:score.components,
      sources:{dexMarketObservation:'T-Bots live DEX feed',jptiEvidenceModel:'JPTI explainable heuristic'},
      observedAt:new Date().toISOString(),decision:'research-only'};
  });
  res.set('Cache-Control','no-store').json({generatedAt:new Date().toISOString(),count:evidence.length,evidence,
    policy:'Evidence score is a discovery/ranking feature, not a token safety pass. Rug Check remains an independent mandatory gate.'});
});

universalRouter.get('/universal/risk',async(req,res)=>{
  try{requirePrivateApiAuth(req);const events=await getLedgerTransactions();const settings={maxConsecutiveLosses:req.query.maxConsecutiveLosses,maxDailyLossUsd:req.query.maxDailyLossUsd};res.set('Cache-Control','no-store').json(calculateUnifiedRisk(events,settings));}
  catch(e){res.status(e.status||401).json({error:e.message});}
});

universalRouter.get('/universal/performance',async(req,res)=>{
  try{requirePrivateApiAuth(req);res.set('Cache-Control','no-store').json(buildUnifiedPerformance(await getLedgerTransactions()));}
  catch(e){res.status(e.status||401).json({error:e.message});}
});
