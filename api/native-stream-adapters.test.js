import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeStreamConfig,parseNativeTicker } from './native-stream-adapters.js';
test('builds public native ticker stream subscriptions for four supported venues',()=>{
 for(const id of ['binance','bybit','okx','bitget'])assert.ok(buildNativeStreamConfig(id,{id:'BTCUSDT',spot:true}));
 assert.equal(buildNativeStreamConfig('bybit',{id:'BTCUSDT',swap:true}),null);
 assert.equal(buildNativeStreamConfig('kraken',{id:'XBTUSDT',spot:true}),null);
});
test('normalizes Binance and Bybit native ticker messages',()=>{
 const b=parseNativeTicker('binance',JSON.stringify({e:'24hrTicker',E:1700000000000,c:'50000',b:'49999',a:'50001',v:'10',q:'500000',P:'2'}),'BTC/USDT',1700000001000);
 assert.equal(b.last,50000);assert.equal(b.transport,'native-websocket');assert.equal(b.stale,false);
 const y=parseNativeTicker('bybit',{topic:'tickers.BTCUSDT',ts:1700000000000,data:{lastPrice:'50000',bid1Price:'49999',ask1Price:'50001',volume24h:'10',turnover24h:'500000',price24hPcnt:'0.02'}},'BTC/USDT',1700000001000);
 assert.equal(y.last,50000);assert.equal(y.changePct,2);
});
test('ignores subscription acknowledgements, malformed and unknown messages',()=>{
 assert.equal(parseNativeTicker('binance','not-json','BTC/USDT'),null);
 assert.equal(parseNativeTicker('okx',{event:'subscribe'},'BTC/USDT'),null);
 assert.equal(parseNativeTicker('bitget',{arg:{channel:'ticker'},data:[{lastPr:'0'}]},'BTC/USDT'),null);
});
