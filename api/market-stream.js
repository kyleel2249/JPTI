import express from 'express';
import { createExchange } from './exchanges.js';

export const marketStreamRouter=express.Router();
const MAX_CLIENTS=Math.max(1,Math.min(100,Number(process.env.JPTI_STREAM_MAX_CLIENTS)||25));
const clients=new Set();

export function normalizeStreamRequest(query={}){
 const exchange=String(query.exchange||'binance').trim().toLowerCase();
 const symbol=String(query.symbol||'BTC/USDT').trim().toUpperCase();
 const intervalMs=Number.parseInt(query.intervalMs||'5000',10);
 if(!/^[a-z0-9_-]{2,30}$/.test(exchange))throw Object.assign(new Error('Invalid exchange identifier.'),{status:400});
 if(!/^[A-Z0-9._-]{1,20}\/[A-Z0-9._-]{1,20}$/.test(symbol))throw Object.assign(new Error('Use a normalized BASE/QUOTE symbol.'),{status:400});
 if(!Number.isInteger(intervalMs)||intervalMs<3000||intervalMs>60000)throw Object.assign(new Error('intervalMs must be between 3000 and 60000 milliseconds.'),{status:400});
 return {exchange,symbol,intervalMs};
}

marketStreamRouter.get('/market',async(req,res)=>{
 let options;
 try{options=normalizeStreamRequest(req.query);}catch(error){return res.status(error.status||400).json({error:error.message});}
 if(clients.size>=MAX_CLIENTS)return res.status(503).json({error:'Market stream capacity reached. Retry later.',maxClients:MAX_CLIENTS});
 let exchange;
 let closed=false,inFlight=false,timer,heartbeat;
 const client={id:Symbol('market-stream')};clients.add(client);
 const close=async()=>{
  if(closed)return;closed=true;clients.delete(client);
  if(timer)clearInterval(timer);
  if(heartbeat)clearInterval(heartbeat);
  if(exchange&&typeof exchange.close==='function'){try{await exchange.close();}catch{}}
 };
 res.on('close',close);
 res.status(200);res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
 res.flushHeaders?.();
 const send=(event,data)=>{
  if(closed||res.writableEnded)return;
  res.write('event: '+event+'\n'+'data: '+JSON.stringify(data)+'\n\n');
 };
 send('status',{status:'connecting',transport:'ccxt-rest-polling-sse',exchange:options.exchange,symbol:options.symbol,intervalMs:options.intervalMs});
 try{
  exchange=createExchange(options.exchange,{privateAccess:false});
  await exchange.loadMarkets();
  if(!exchange.markets?.[options.symbol])throw Object.assign(new Error('Symbol is not listed on this exchange.'),{status:404});
  if(!exchange.has?.fetchTicker)throw Object.assign(new Error('Exchange ticker capability is unavailable.'),{status:501});
  const sample=async()=>{
   if(closed||inFlight)return;
   inFlight=true;
   try{
    const ticker=await exchange.fetchTicker(options.symbol);
    const observedAt=Number.isFinite(ticker.timestamp)?new Date(ticker.timestamp).toISOString():null;
    send('quote',{exchange:options.exchange,symbol:options.symbol,last:ticker.last,bid:ticker.bid,ask:ticker.ask,
     baseVolume:ticker.baseVolume,quoteVolume:ticker.quoteVolume,changePct:ticker.percentage,
     observedAt,receivedAt:new Date().toISOString(),stale:!observedAt||Date.now()-ticker.timestamp>Math.max(15000,options.intervalMs*3),
     transport:'ccxt-rest-polling-sse'});
   }catch(error){send('warning',{exchange:options.exchange,symbol:options.symbol,message:error.message,receivedAt:new Date().toISOString()});}
   finally{inFlight=false;}
  };
  send('status',{status:'connected',transport:'ccxt-rest-polling-sse',exchange:options.exchange,symbol:options.symbol,intervalMs:options.intervalMs});
  await sample();
  if(!closed){
   timer=setInterval(sample,options.intervalMs);
   heartbeat=setInterval(()=>send('heartbeat',{at:new Date().toISOString()}),15000);
  }
 }catch(error){
  send('error',{message:error.message,status:error.status||502});
  await close();
  res.end();
 }
});

marketStreamRouter.get('/status',(_req,res)=>res.json({transport:'ccxt-rest-polling-sse',activeClients:clients.size,maxClients:MAX_CLIENTS,exchangeNativeWebSockets:false,
 note:'This phase provides bounded server-sent events backed by CCXT REST polling. It does not claim native exchange WebSocket feeds.'}));
