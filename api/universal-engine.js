import express from 'express';
import { withExchange } from './exchanges.js';
import { requirePrivateApiAuth } from './policy.js';
import { getLedgerTransactions } from './operations.js';
import { buildEvidenceCouncil } from './advanced-intelligence.js';
import { normalizeDexPair, scoreAssetEvidence, summarizeBotMemory } from './multi-asset-intelligence.js';

export const universalRouter = express.Router();
const finite = v => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
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


export function fillsCount(events) { return events.filter(e=>e.eventType==='fill').length; }

export function calculateExchangeRealized(events, now = Date.now()) {
  const inventory = new Map(), realizedByQuote = {}, dailyByQuote = {}, feeTotals = {};
  const fills = events.filter(e=>e.eventType==='fill' && e.symbol && e.side && finite(e.quantity)>0 && finite(e.price)>0)
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
  for(const e of fills){
    const key=e.source+':'+e.accountId+':'+e.symbol;
    const [base,quote]=String(e.symbol).split('/');
    if(!base||!quote)continue;
    const row=inventory.get(key)||{quantity:0,cost:0,base,quote,exchange:e.source,symbol:e.symbol};
    const qty=Number(e.quantity),price=Number(e.price),fee=finite(e.fee)||0;
    if(e.feeCurrency)feeTotals[e.feeCurrency]=(feeTotals[e.feeCurrency]||0)+fee;
    let realized=0;
    if(e.side==='buy'){row.cost+=qty*price;row.quantity+=qty;}
    else{
      const matched=Math.min(qty,row.quantity),avg=row.quantity>0?row.cost/row.quantity:0;
      realized=(price-avg)*matched;
      row.quantity-=matched;row.cost=Math.max(0,row.cost-avg*matched);
      if(row.quantity<1e-12){row.quantity=0;row.cost=0;}
      // Only quote-denominated fees are subtracted from quote PnL; other fee tokens remain separate.
      if(e.feeCurrency===quote)realized-=fee;
      realizedByQuote[quote]=(realizedByQuote[quote]||0)+realized;
      if(Date.parse(e.occurredAt)>=now-86400000)dailyByQuote[quote]=(dailyByQuote[quote]||0)+realized;
    }
    inventory.set(key,row);
  }
  return {realizedByQuote,dailyByQuote,feeTotals,openInventory:[...inventory.values()].filter(x=>x.quantity>0).map(x=>({...x,averageCost:x.cost/x.quantity})),
    caveat:'Weighted-average cost on recorded fills only. Missing opening inventory, transfers, funding, taxes and fees paid in third tokens prevent a complete account PnL statement.'};
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
  const exchangeRealized = calculateExchangeRealized(events, now);
  const dailyByQuote = { ...exchangeRealized.dailyByQuote };
  for(const trade of recent) dailyByQuote[trade.quote]=(dailyByQuote[trade.quote]||0)+trade.pnl;
  dailyByQuote.USD = (dailyByQuote.USD || 0) + (dailyByQuote.USDT || 0) + (dailyByQuote.USDC || 0) + (dailyByQuote.DAI || 0) + (dailyByQuote.FDUSD || 0);
  const paperDailyUsd = closed.filter(e=>Date.parse(e.at)>=dayAgo).reduce((sum,e)=>sum+e.pnl,0);
  const stableDailyUsd = ['USDT','USDC','DAI','FDUSD'].reduce((sum,q)=>sum+(exchangeRealized.dailyByQuote[q]||0),0);
  const usdLoss = Math.max(0,-(paperDailyUsd + stableDailyUsd + (exchangeRealized.dailyByQuote.USD||0)));
  const reasons=[];
  if(streak>=maxConsecutiveLosses) reasons.push('consecutive_paper_loss_limit');
  if(maxDailyLossUsd>0 && usdLoss>=maxDailyLossUsd) reasons.push('daily_usd_loss_limit');
  return { generatedAt:new Date(now).toISOString(), newEntriesAllowed:reasons.length===0, pauseReasons:reasons,
    consecutiveLosses:streak, maxConsecutiveLosses, rolling24hRealizedPnlByQuote:dailyByQuote,
    maxDailyLossUsd, rolling24hUsdLoss:usdLoss,
    sources:{tbotsPaperClosedTrades:closed.length,jptiExchangeFills:fillsCount(events)}, exchangeRealizedPnlByQuote:exchangeRealized.realizedByQuote, exchangeFeesByCurrency:exchangeRealized.feeTotals,
    exitsRemainEnabled:true, mode:'paper-first',
    caveat:'T-Bots paper PnL is USD-denominated. Exchange realized PnL is calculated from recorded fills; USD/USDT/USDC/DAI/FDUSD quote amounts are treated as approximate USD equivalents for the daily guard. Other quote currencies remain separate until an FX source is available.' };
}

export function buildUnifiedPerformance(events) {
  const trades = events.filter(e=>e.source==='tbots' && e.eventType==='bot_trade' && e.metadata?.action==='paper_closed');
  const pnl = trades.map(e=>finite(e.metadata?.pnl)).filter(v=>v!==null);
  const wins=pnl.filter(v=>v>0).length;
  const bySymbol={};
  for(const e of trades){const key=e.symbol||'unknown';const v=finite(e.metadata?.pnl);if(v===null)continue;const row=bySymbol[key]||(bySymbol[key]={trades:0,pnl:0,wins:0});row.trades++;row.pnl+=v;if(v>0)row.wins++;}
  const fills=events.filter(e=>e.eventType==='fill');
  const realized=calculateExchangeRealized(events);
  const byVenue={};
  for(const e of fills){const row=byVenue[e.source]||(byVenue[e.source]={fills:0,buyQty:0,sellQty:0,feesByCurrency:{}});row.fills++;if(e.side==='buy')row.buyQty+=e.quantity||0;if(e.side==='sell')row.sellQty+=e.quantity||0;if(e.feeCurrency)row.feesByCurrency[e.feeCurrency]=(row.feesByCurrency[e.feeCurrency]||0)+(e.fee||0);}
  return {generatedAt:new Date().toISOString(),paperStrategy:{closedTrades:pnl.length,wins,losses:pnl.length-wins,winRatePercent:pnl.length?wins/pnl.length*100:null,realizedPnlUsd:pnl.reduce((a,b)=>a+b,0),bySymbol},
    exchangeExecution:{fillCount:fills.length,byVenue,realizedPnlByQuote:realized.realizedByQuote,feesByCurrency:realized.feeTotals,openInventory:realized.openInventory,realizedPnl:'weighted-average on recorded fills only; quote currencies remain separate'},
    attributionDimensions:['asset/pair','venue','paper-vs-exchange','strategy profile when tagged','session'],
    caveat:'No untagged trade is assigned to a strategy. Exchange fills are activity records, not automatically equivalent to closed trades.'};
}


universalRouter.get('/universal/macro',async(_req,res)=>{
  const sources={};
  const jobs=[
    ['coingeckoGlobal',()=>fetch('https://api.coingecko.com/api/v3/global',{signal:AbortSignal.timeout(9000)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})],
    ['defillamaChains',()=>fetch('https://api.llama.fi/v2/chains',{signal:AbortSignal.timeout(9000)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})]
  ];
  if(process.env.JPTI_FRED_API_KEY)jobs.push(['fred',()=>fetch('https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key='+encodeURIComponent(process.env.JPTI_FRED_API_KEY)+'&file_type=json&sort_order=desc&limit=3',{signal:AbortSignal.timeout(9000)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})]);
  const results=await Promise.allSettled(jobs.map(async([name,task])=>[name,await task()]));
  for(let i=0;i<results.length;i++){
    const name=jobs[i][0],result=results[i];
    if(result.status==='fulfilled')sources[name]={status:'live',data:result.value[1]};
    else sources[name]={status:'unavailable',error:result.reason?.message||'Provider unavailable'};
  }
  const global=sources.coingeckoGlobal?.data?.data;
  const chains=sources.defillamaChains?.data;
  const fed=sources.fred?.data?.observations||[];
  res.set('Cache-Control','no-store').json({generatedAt:new Date().toISOString(),
    crypto:{marketCapUsd:finite(global?.total_market_cap?.usd),marketCapChange24hPercent:finite(global?.market_cap_change_percentage_24h_usd),btcDominancePercent:finite(global?.market_cap_percentage?.btc),ethDominancePercent:finite(global?.market_cap_percentage?.eth),activeCryptocurrencies:finite(global?.active_cryptocurrencies)},
    defi:{chainCount:Array.isArray(chains)?chains.length:0,totalValueLockedUsd:Array.isArray(chains)?chains.reduce((s,x)=>s+(finite(x.tvl)||0),0):null},
    macro:{fedFundsLatest:fed[0]?.value&&fed[0].value!=='.'?finite(fed[0].value):null,observations:fed},
    sources:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,{status:v.status,error:v.error||null}])),
    note:'Global risk context only; not token-specific. FRED is available only when configured. Provider timestamps, quotas and geographic/asset coverage vary.'});
});

universalRouter.get('/universal/news',async(req,res)=>{
  const q=String(req.query.q||'crypto markets OR central bank OR digital assets').slice(0,180);
  try{
    const url='https://api.gdeltproject.org/api/v2/doc/doc?query='+encodeURIComponent(q)+'&mode=ArtList&format=json&sort=HybridRel&maxrecords=30';
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('GDELT HTTP '+response.status);
    const body=await response.json();
    res.set('Cache-Control','no-store').json({query:q,fetchedAt:new Date().toISOString(),source:'GDELT',articles:(body.articles||[]).map(a=>({title:a.title,url:a.url,domain:a.domain,seendate:a.seendate,sourcecountry:a.sourcecountry})),note:'News discovery is not sentiment validation. Verify original reporting and publication time.'});
  }catch(e){res.status(502).json({error:e.message});}
});

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
      if(ex.has?.fetchOHLCV)tasks.mtf=Promise.all(['15m','1h','4h','1d'].filter(tf=>!ex.timeframes||ex.timeframes[tf]).map(async tf=>({timeframe:tf,candles:await ex.fetchOHLCV(symbol,tf,undefined,40).catch(()=>null)})));
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
    const mtf=(data.mtf||[]).map(row=>({timeframe:row.timeframe,direction:row.candles?.length>=20&&Number(row.candles.at(-1)[4])>Number(row.candles.at(-20)[4])?1:row.candles?.length>=20&&Number(row.candles.at(-1)[4])<Number(row.candles.at(-20)[4])?-1:0}));
    const alignment=mtf.length?mtf.reduce((s,x)=>s+x.direction,0)/mtf.length:null;
    const gains=[],losses=[];for(let i=Math.max(1,closes.length-14);i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>0)gains.push(d);else losses.push(-d);}
    const avgGain=gains.reduce((a,b)=>a+b,0)/14,avgLoss=losses.reduce((a,b)=>a+b,0)/14;
    const rsi14=avgLoss===0?(avgGain>0?100:50):100-100/(1+avgGain/avgLoss);
    const visibleDepthUsd=bd+ad;
    const evidence={momentumPct,relativeVolume:relVol,orderBookImbalance:imbalance,fundingRate:finite(data.funding?.fundingRate),openInterest:data.openInterest||null,
      timeframeAlignment:alignment,rsi14,visibleDepthUsd,multiTimeframe:mtf};
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


const GOPLUS_IDS={ethereum:'1',bsc:'56',polygon:'137',arbitrum:'42161',optimism:'10',base:'8453',avalanche:'43114',linea:'59144',blast:'81457'};
universalRouter.get('/universal/asset/:chain/:address',async(req,res)=>{
  try{
    requirePrivateApiAuth(req);
    const chain=String(req.params.chain).toLowerCase(),address=String(req.params.address);
    if(!/^[a-z0-9-]{2,32}$/.test(chain)||address.length<20||address.length>64)return res.status(400).json({error:'Invalid chain or token address.'});
    const [pairsResult,securityResult]=await Promise.allSettled([
      fetch('https://api.dexscreener.com/token-pairs/v1/'+encodeURIComponent(chain)+'/'+encodeURIComponent(address),{signal:AbortSignal.timeout(10000)}).then(async r=>{if(!r.ok)throw new Error('DexScreener HTTP '+r.status);return r.json();}),
      chain==='solana'
        ? fetch('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(address)+'/report',{signal:AbortSignal.timeout(10000)}).then(async r=>{if(!r.ok)throw new Error('RugCheck HTTP '+r.status);return r.json();})
        : GOPLUS_IDS[chain]
          ? fetch('https://api.gopluslabs.io/api/v1/token_security/'+GOPLUS_IDS[chain]+'?contract_addresses='+encodeURIComponent(address),{signal:AbortSignal.timeout(10000)}).then(async r=>{if(!r.ok)throw new Error('GoPlus HTTP '+r.status);return r.json();})
          : Promise.reject(new Error('No validated security adapter for this chain.'))
    ]);
    const pairs=pairsResult.status==='fulfilled'&&Array.isArray(pairsResult.value)?pairsResult.value:[];
    const normalized=pairs.map(normalizeDexPair).map(p=>({...p,evidence:scoreAssetEvidence(p)})).sort((a,b)=>b.liquidityUsd-a.liquidityUsd);
    let security=null,securityError=null;
    if(securityResult.status==='fulfilled'){
      const report=securityResult.value;
      if(chain==='solana'){
        const top=Array.isArray(report.topHolders)?report.topHolders:[];
        const risks=Array.isArray(report.risks)?report.risks:[];
        const lpPct=finite(report.markets?.[0]?.lp?.lpLockedPct);
        security={provider:'RugCheck',holders:finite(report.totalHolders),freezeAuthorityOpen:report.freezeAuthority!=null,mintAuthorityOpen:report.mintAuthority!=null,
          top10Percent:top.length?top.slice(0,10).reduce((s,h)=>s+(finite(h.pct)||0),0):null,
          lpLockedPercent:lpPct,risks:risks.map(r=>({name:r.name||null,level:r.level||null,description:r.description||null})).slice(0,30),
          status:report.mintAuthority==null&&report.freezeAuthority==null&&lpPct!==null&&top.length?'evidence_available':'incomplete'};
      }else{
        const item=report?.result?.[address.toLowerCase()]||report?.result?.[address]||null;
        if(item)security={provider:'GoPlus',holders:finite(item.holder_count),mintable:item.is_mintable,honeypot:item.is_honeypot,
          blacklist:item.is_blacklisted,hiddenOwner:item.hidden_owner,proxy:item.is_proxy,buyTax:finite(item.buy_tax),sellTax:finite(item.sell_tax),
          lpHolders:Array.isArray(item.lp_holders)?item.lp_holders.length:null,
          status:item.is_mintable!==undefined&&item.is_honeypot!==undefined&&item.is_blacklisted!==undefined?'evidence_available':'incomplete'};
      }
    }else securityError=securityResult.reason?.message||'Security provider unavailable';
    res.set('Cache-Control','no-store').json({chain,address,fetchedAt:new Date().toISOString(),pairCount:normalized.length,pairs:normalized,
      security,securityError,securityDecision:security?.status==='evidence_available'?'review_required':'fail_closed',
      note:'Provider evidence is not a safety guarantee. Run chain-specific simulations, holder and LP verification, and independent contract review before considering a trade.'});
  }catch(e){res.status(e.status||502).json({error:e.message});}
});

universalRouter.get('/universal/risk',async(req,res)=>{
  try{requirePrivateApiAuth(req);const events=await getLedgerTransactions();const settings={maxConsecutiveLosses:req.query.maxConsecutiveLosses,maxDailyLossUsd:req.query.maxDailyLossUsd};res.set('Cache-Control','no-store').json(calculateUnifiedRisk(events,settings));}
  catch(e){res.status(e.status||401).json({error:e.message});}
});

universalRouter.get('/universal/performance',async(req,res)=>{
  try{requirePrivateApiAuth(req);res.set('Cache-Control','no-store').json(buildUnifiedPerformance(await getLedgerTransactions()));}
  catch(e){res.status(e.status||401).json({error:e.message});}
});
