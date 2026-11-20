import { LiveFeed } from './live-feed.js';

// Combines multi-chain DEX discovery with a user-configured JPTI centralized spot watchlist.
// It remains a paper feed: no exchange order or private trading permission is requested.
export class UniversalFeed extends LiveFeed {
  constructor({ bridge, ...options } = {}) {
    super(options);
    this.bridge = bridge;
    this.kind = 'live-universal-paper';
    this.lastCexRefresh = 0;
    this.cexRefreshMs = 15000;
  }

  async tick() {
    await super.tick();
    if (!this.bridge?.enabled || Date.now() - this.lastCexRefresh < this.cexRefreshMs) return;
    this.lastCexRefresh = Date.now();
    const result = await this.bridge.refreshCexMarkets();
    for (const market of result?.markets || []) {
      const id = market.id;
      if (!id) continue;
      let token = this.tokens.get(id);
      if (!token) {
        token = { id, chainId:'cex', tokenAddress:market.base, tracked:true, hist:[], liqMax:0,
          security:{exchangeListed:true}, holdHist:[], view:null, order:this.ticks };
        this.tokens.set(id,token);
      }
      token.order=this.ticks;
      token.security={exchangeListed:true};
      token.m={...market};
      const prior=token.view;
      const high=Math.max(market.price||0,...token.hist.map(x=>x.price));
      if(Number.isFinite(market.price)&&market.price>0){
        token.hist.push({at:Date.now(),price:market.price});
        token.hist=token.hist.filter(x=>Date.now()-x.at<=3600000);
      }
      token.view={
        id,chain:'cex',tokenAddress:market.base,quoteAddress:market.quote,quoteSymbol:market.quote,
        marketType:'cex',assetClass:'crypto_spot',exchange:market.exchange,symbol:market.symbol,
        dex:market.exchange,ageMin:Infinity,price:market.price,change1hPct:market.change1hPct??0,
        pullbackPct:high>0?(1-market.price/high)*100:0,liquidityUsd:market.liquidityUsd??0,
        volume5mUsd:market.volume5mUsd??0,volume5mAvgUsd:market.volume5mAvgUsd??0,
        volume1hUsd:(market.volume5mUsd??0)*12,volume24hUsd:market.quoteVolume24h??0,
        buys1h:0,sells1h:0,buyRatio:null,holders:null,holderGrowth10mPct:null,
        smartWallets10m:null,kolBought:null,spreadPct:market.spreadPct,
        quoteVolume24h:market.quoteVolume24h,exchangeMarketActive:market.exchangeMarketActive===true,
        security:token.security,events:{devSold:false,lpPulled:false},dead:false,
        fetchedAt:market.fetchedAt,previousPrice:prior?.price??null
      };
    }
  }
}
