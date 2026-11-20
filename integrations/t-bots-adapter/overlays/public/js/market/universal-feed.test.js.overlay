import test from 'node:test';
import assert from 'node:assert/strict';
import { UniversalFeed } from './universal-feed.js';

test('universal feed combines CEX spot watchlist with DEX discovery snapshot', async () => {
  const bridge={enabled:true,refreshCexMarkets:async()=>({markets:[{
    id:'cex:binance:BTC/USDT',exchange:'binance',symbol:'BTC/USDT',base:'BTC',quote:'USDT',
    price:65000,quoteVolume24h:250000000,liquidityUsd:500000,volume5mUsd:100000,
    volume5mAvgUsd:50000,change1hPct:1.2,spreadPct:0.02,exchangeMarketActive:true,fetchedAt:new Date().toISOString()
  }]})};
  const feed=new UniversalFeed({bridge,fetchImpl:async()=>({ok:true,json:async()=>[]})});
  await feed.tick();
  const market=feed.snapshot().find(x=>x.marketType==='cex');
  assert.ok(market);
  assert.equal(market.exchange,'binance');
  assert.equal(market.symbol,'BTC/USDT');
  assert.equal(market.security.exchangeListed,true);
});

test('universal feed remains safe without a connected JPTI bridge', async () => {
  const feed=new UniversalFeed({bridge:null,fetchImpl:async()=>({ok:true,json:async()=>[]})});
  await feed.tick();
  assert.equal(feed.snapshot().length,0);
});
