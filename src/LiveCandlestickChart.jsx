import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from './lib/api.js';
import { detectSmartMoney } from './smartMoney.js';

const TIMEFRAMES = [
  ['1m', '1m'], ['3m', '3m'], ['5m', '5m'], ['15m', '15m'], ['30m', '30m'],
  ['1h', '1H'], ['2h', '2H'], ['4h', '4H'], ['6h', '6H'], ['8h', '8H'],
  ['12h', '12H'], ['1d', '1D'], ['3d', '3D'], ['1w', '1W'], ['1M', '1M']
];
const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT'];

function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  let previous = values[0];
  return values.map((value, index) => {
    previous = index === 0 ? value : value * k + previous * (1 - k);
    return previous;
  });
}
function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
function bollinger(values, period = 20, multiplier = 2) {
  const upper = [], lower = [];
  values.forEach((value, index) => {
    if (index < period - 1) { upper.push(Number.NaN); lower.push(Number.NaN); return; }
    const window = values.slice(index - period + 1, index + 1);
    const mean = window.reduce((sum, item) => sum + item, 0) / period;
    const variance = window.reduce((sum, item) => sum + (item - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance) * multiplier;
    upper.push(mean + deviation); lower.push(mean - deviation);
  });
  return { upper, lower };
}
function macd(values) {
  if (values.length < 35) return null;
  const fast = ema(values, 12), slow = ema(values, 26);
  const line = fast.map((value, index) => value - slow[index]);
  const signal = ema(line, 9);
  return { line: line[line.length - 1], signal: signal[signal.length - 1], histogram: line[line.length - 1] - signal[signal.length - 1] };
}
function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const ranges = candles.slice(1).map((c, i) => Math.max(c[2] - c[3], Math.abs(c[2] - candles[i][4]), Math.abs(c[3] - candles[i][4])));
  return ranges.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

const fmt = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 });
function pipIncrementFor(symbol, price) {
  const pair = String(symbol || '').replace(/[^A-Z]/g, '');
  const fiat = new Set(['USD','EUR','GBP','JPY','CHF','CAD','AUD','NZD']);
  const base = pair.slice(0,3), quote = pair.slice(3,6);
  if (pair.length === 6 && fiat.has(base) && fiat.has(quote)) return quote === 'JPY' ? 0.01 : 0.0001;
  if (price >= 1000) return 1;
  if (price >= 100) return 0.1;
  if (price >= 10) return 0.01;
  if (price >= 1) return 0.001;
  if (price >= 0.1) return 0.0001;
  if (price >= 0.01) return 0.00001;
  return 0.000001;
}
function calibratedPriceTicks(min, max, symbol) {
  const range = max - min, center = (min + max) / 2;
  let step = pipIncrementFor(symbol, center);
  if (!Number.isFinite(step) || step <= 0) step = range / 20;
  while (range / step > 40) step *= 10;
  const first = Math.ceil(min / step) * step, ticks = [];
  for (let value = first; value <= max + step * 0.000001 && ticks.length < 45; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}
const timeLabel = (stamp, timeframe) => {
  const date = new Date(stamp);
  return ['1d', '3d', '1w', '1M'].includes(timeframe)
    ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function LiveCandlestickChart({ exchange, symbol, onSymbolChange, initialTimeframe, onTimeframeChange, alphaLevels = [] }) {
  const [timeframe, setTimeframe] = useState(initialTimeframe || '1h');
  const [candles, setCandles] = useState([]);
  const [marketSymbols, setMarketSymbols] = useState(SYMBOLS);
  const [supportedTimeframes, setSupportedTimeframes] = useState(null);
  const [marketType, setMarketType] = useState('futures');
  const [marketSearch, setMarketSearch] = useState('');
  const [marketCounts, setMarketCounts] = useState(null);
  const [drawMode, setDrawMode] = useState('off');
  const [drawings, setDrawings] = useState([]);
  const [showVwap, setShowVwap] = useState(false);
  const [showObv, setShowObv] = useState(false);
  const [showStochRsi, setShowStochRsi] = useState(false);
  const [showSupertrend, setShowSupertrend] = useState(false);
  const [showFvg, setShowFvg] = useState(true);
  const [showSweeps, setShowSweeps] = useState(true);
  const [showStructure, setShowStructure] = useState(true);
  const [showOrderBlocks, setShowOrderBlocks] = useState(true);
  const [swingLength, setSwingLength] = useState(3);
  const [ticker, setTicker] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showEma20, setShowEma20] = useState(false);
  const [showEma50, setShowEma50] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [candleSpacing, setCandleSpacing] = useState(1.35);
  const [candleBodyPct, setCandleBodyPct] = useState(88);
  const [volumeHeight, setVolumeHeight] = useState(78);
  const [marketContext, setMarketContext] = useState(null);
  const [contextError, setContextError] = useState('');
  const [crosshair, setCrosshair] = useState(null);

  useEffect(() => { if (initialTimeframe && initialTimeframe !== timeframe) setTimeframe(initialTimeframe); }, [initialTimeframe]);
  useEffect(() => { if (onTimeframeChange) onTimeframeChange(timeframe); }, [timeframe, onTimeframeChange]);

  useEffect(() => {
    let active = true;
    const refreshCatalog = async () => {
      try {
        const response = await apiFetch('/api/exchanges/' + exchange + '/markets?type=' + marketType + '&search=' + encodeURIComponent(marketSearch));
        const data = await response.json();
        if (!active || !response.ok) return;
        const symbols = (data.markets || []).map((market) => market.symbol);
        setMarketSymbols(symbols);
        setMarketCounts(data.counts || null);
        if (symbols.length && !symbols.includes(symbol)) {
          const preferred = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];
          onSymbolChange(preferred.find((item) => symbols.includes(item)) || symbols[0]);
        }
        const frames = Array.isArray(data.timeframes) && data.timeframes.length ? data.timeframes : null;
        setSupportedTimeframes(frames);
        if (frames && !frames.includes(timeframe)) setTimeframe(frames.includes('1h') ? '1h' : frames[0]);
      } catch { /* Keep the last successful catalog visible during temporary exchange outages. */ }
    };
    refreshCatalog();
    const timer = setInterval(refreshCatalog, 300000);
    return () => { active = false; clearInterval(timer); };
  }, [exchange, marketType, marketSearch]);

  const load = async () => {
    setLoading(true);
    try {
      const encodedSymbol = symbol.replace('/', '-');
      const [candleResponse, tickerResponse, contextResponse] = await Promise.all([
        apiFetch('/api/exchanges/' + exchange + '/ohlcv/' + encodedSymbol + '?timeframe=' + timeframe + '&limit=200'),
        apiFetch('/api/exchanges/' + exchange + '/ticker/' + encodedSymbol),
        apiFetch('/api/intelligence/market/' + exchange + '/' + encodedSymbol + '/context?timeframe=' + timeframe)
      ]);
      const [candleData, tickerData, contextResponseData] = await Promise.all([candleResponse.json(), tickerResponse.json(), contextResponse.json()]);
      if (!candleResponse.ok) throw new Error(candleData.error || 'Candlestick data unavailable for this market and timeframe.');
      setCandles((candleData.candles || []).filter((row) => row.length >= 6).map((row) => row.map(Number)));
      setError('');
      if (tickerResponse.ok) setTicker(tickerData);
      if (contextResponse.ok) { setMarketContext(contextResponseData); setContextError(''); } else setContextError(contextResponseData.error || 'Context analysis unavailable');
    } catch (e) {
      setError(e.message);
      setCandles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const encodedSymbol = symbol.replace('/', '-');
        const [candleResponse, tickerResponse, contextResponse] = await Promise.all([
          apiFetch('/api/exchanges/' + exchange + '/ohlcv/' + encodedSymbol + '?timeframe=' + timeframe + '&limit=200'),
          apiFetch('/api/exchanges/' + exchange + '/ticker/' + encodedSymbol),
          apiFetch('/api/intelligence/market/' + exchange + '/' + encodedSymbol + '/context?timeframe=' + timeframe)
        ]);
        const [candleData, tickerData, contextResponseData] = await Promise.all([candleResponse.json(), tickerResponse.json(), contextResponse.json()]);
        if (!active) return;
        if (!candleResponse.ok) throw new Error(candleData.error || 'Candlestick data unavailable for this market and timeframe.');
        setCandles((candleData.candles || []).filter((row) => row.length >= 6).map((row) => row.map(Number)));
        if (tickerResponse.ok) setTicker(tickerData);
        if (contextResponse.ok) { setMarketContext(contextResponseData); setContextError(''); } else setContextError(contextResponseData.error || 'Context analysis unavailable');
        setError('');
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    refresh();
    const timer = setInterval(refresh, 20000);
    return () => { active = false; clearInterval(timer); };
  }, [exchange, symbol, timeframe]);

  const metrics = useMemo(() => {
    const closes = candles.map((c) => c[4]);
    const last = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    return {
      ema20: ema(closes, 20), ema50: ema(closes, 50),
      bollinger: bollinger(closes), macd: macd(closes),
      rsi: rsi(closes), atr: atr(candles),
      last, previous,
      change: last && previous ? ((last[4] - previous[4]) / previous[4]) * 100 : null,
      volume: candles.slice(-20).reduce((sum, c) => sum + c[5], 0) / Math.min(20, candles.length),
      vwap: (() => { const rows = candles.slice(-100); const pv = rows.reduce((sum,c) => sum + ((c[2]+c[3]+c[4])/3)*c[5],0); const vol = rows.reduce((sum,c) => sum+c[5],0); return vol ? pv/vol : null; })(),
      obv: candles.reduce((sum,c,i) => i === 0 ? 0 : sum + (c[4] > candles[i-1][4] ? c[5] : c[4] < candles[i-1][4] ? -c[5] : 0),0),
      stochRsi: (() => { if (closes.length < 28) return null; const values=[]; for(let i=27;i<closes.length;i++) { const value=rsi(closes.slice(0,i+1)); if(value!=null) values.push(value); } const current=rsi(closes); if(current==null||!values.length)return null; const lo=Math.min(...values.slice(-14)),hi=Math.max(...values.slice(-14)); return hi===lo?50:(current-lo)/(hi-lo)*100; })(),
      supertrend: (() => { if(candles.length<15)return null; const last=candles[candles.length-1]; const range=atr(candles,14); return range==null?null:(last[4] >= (last[2]+last[3])/2 ? 'Bullish bias' : 'Bearish bias'); })()
    };
  }, [candles]);

  const smartMoney = useMemo(() => detectSmartMoney(candles.slice(0, -1), swingLength), [candles, swingLength]);

  const geometry = useMemo(() => {
    if (!candles.length) return null;
    const count = Math.max(25, Math.min(candles.length, Math.floor(candles.length / (zoom * candleSpacing))));
    const rows = candles.slice(-count);
    const levelPrices = (alphaLevels || []).map(level => Number(level.price)).filter(Number.isFinite);
    const min = Math.min(...rows.map((c) => c[3]), ...levelPrices);
    const max = Math.max(...rows.map((c) => c[2]), ...levelPrices);
    const padding = (max - min || max * 0.002 || 1) * 0.09;
    const low = min - padding, high = max + padding;
    const left = 12, right = 920, top = 18, priceBottom = 280, volumeBottom = 378;
    const x = (i) => left + (i + 0.5) * ((right - left) / rows.length);
    const y = (price) => top + ((high - price) / (high - low)) * (priceBottom - top);
    const maxVol = Math.max(1, ...rows.map((c) => c[5]));
    const points = (values) => values.slice(candles.length - count).map((value, i) => Number.isFinite(value) ? x(i) + ',' + y(value) : null).filter(Boolean).join(' ');
    return { rows, count, min: low, max: high, left, right, top, priceBottom, volumeBottom, x, y, maxVol, points };
  }, [candles, zoom, candleSpacing, alphaLevels]);

  const activeCandle = crosshair !== null && geometry ? geometry.rows[crosshair] : metrics.last;
  const candleSlot = geometry ? (geometry.right - geometry.left) / geometry.count : 6;
  const candleWidth = Math.max(2, Math.min(36, candleSlot * candleBodyPct / 100));

  return <section className="panel exchange-connect trading-chart-panel">
    <div className="panelhead">
      <span><b>Live market chart</b><small>OHLCV exchange data · {exchange.toUpperCase()}</small></span>
      <i className={candles.length ? "running" : "standby"}>{candles.length ? "LIVE MARKET DATA" : loading ? "CONNECTING" : "NO DATA"}</i>
    </div>
    <div className="chart-toolbar">
      <label>Type</label>
      <select aria-label="Market type" value={marketType} onChange={(e) => setMarketType(e.target.value)}><option value="spot">Spot</option><option value="futures">Futures / Perpetuals</option><option value="margin">Margin-enabled</option><option value="cfd">CFDs</option><option value="options">Options</option><option value="all">All instruments</option></select>
      <input className="market-search" aria-label="Search markets" placeholder="Search pair…" value={marketSearch} onChange={(e) => setMarketSearch(e.target.value)} />
      <label htmlFor="jpti-symbol">Pair</label>
      <select id="jpti-symbol" value={symbol} onChange={(e) => onSymbolChange(e.target.value)}>
        {marketSymbols.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <div className="timeframe-list" role="group" aria-label="Chart timeframe">
        {TIMEFRAMES.filter(([value]) => !supportedTimeframes || supportedTimeframes.includes(value)).map(([value, label]) => <button key={value} className={timeframe === value ? 'active' : ''} onClick={() => setTimeframe(value)}>{label}</button>)}
      </div>
      <div className="chart-actions">
        <button onClick={() => setZoom((v) => Math.min(4, v * 1.35))} title="Zoom in">＋</button>
        <button onClick={() => setZoom((v) => Math.max(0.5, v / 1.35))} title="Zoom out">－</button>
        <button onClick={() => setZoom(1)} title="Fit all candles">Fit</button>
        <button onClick={load} title="Refresh chart">{loading ? '…' : '↻'}</button>
      </div>
    </div>
    <div className="chart-size-controls" aria-label="Chart sizing controls">
      <label><span>Candle spacing <b>{candleSpacing.toFixed(2)}×</b></span><input aria-label="Candle spacing" type="range" min="0.65" max="10" step="0.05" value={candleSpacing} onChange={(e) => setCandleSpacing(Number(e.target.value))}/></label>
      <label><span>Candle body width <b>{candleBodyPct}%</b></span><input aria-label="Candle body width" type="range" min="35" max="100" step="1" value={candleBodyPct} onChange={(e) => setCandleBodyPct(Number(e.target.value))}/></label>
      <label><span>Volume height <b>{volumeHeight}px</b></span><input aria-label="Volume height" type="range" min="20" max="90" step="1" value={volumeHeight} onChange={(e) => setVolumeHeight(Number(e.target.value))}/></label>
      <button type="button" onClick={() => { setCandleSpacing(1.35); setCandleBodyPct(88); setVolumeHeight(78); setZoom(1); }}>Reset chart sizing</button>
    </div>
    <div className="chart-indicator-controls">
      <label><input type="checkbox" checked={showEma20} onChange={(e) => setShowEma20(e.target.checked)}/> EMA 20</label>
      <label><input type="checkbox" checked={showEma50} onChange={(e) => setShowEma50(e.target.checked)}/> EMA 50</label>
      <label><input type="checkbox" checked={showBollinger} onChange={(e) => setShowBollinger(e.target.checked)}/> Bollinger</label>
      <label><input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)}/> Volume</label>
      <label><input type="checkbox" checked={showVwap} onChange={(e) => setShowVwap(e.target.checked)}/> VWAP</label>
      <label><input type="checkbox" checked={showStochRsi} onChange={(e) => setShowStochRsi(e.target.checked)}/> Stoch RSI</label>
      <label><input type="checkbox" checked={showObv} onChange={(e) => setShowObv(e.target.checked)}/> OBV</label>
      <label><input type="checkbox" checked={showSupertrend} onChange={(e) => setShowSupertrend(e.target.checked)}/> Price trend bias</label>
      <label className="smc-toggle"><input type="checkbox" checked={showFvg} onChange={(e) => setShowFvg(e.target.checked)}/> FVG</label>
      <label className="smc-toggle"><input type="checkbox" checked={showSweeps} onChange={(e) => setShowSweeps(e.target.checked)}/> Liquidity sweeps</label>
      <label className="smc-toggle"><input type="checkbox" checked={showStructure} onChange={(e) => setShowStructure(e.target.checked)}/> BOS / CHoCH</label>
      <label className="smc-toggle"><input type="checkbox" checked={showOrderBlocks} onChange={(e) => setShowOrderBlocks(e.target.checked)}/> Order blocks</label>
      <label className="smc-sensitivity">Swing <select aria-label="SMC swing sensitivity" value={swingLength} onChange={(e) => setSwingLength(Number(e.target.value))}><option value={2}>Fast (2)</option><option value={3}>Normal (3)</option><option value={5}>Strict (5)</option><option value={8}>Wide (8)</option></select></label>
      <label>Draw <select value={drawMode} onChange={(e) => setDrawMode(e.target.value)}><option value="off">Off</option><option value="horizontal">S/R level</option><option value="trend">Trend line (2 clicks)</option></select></label>
      <span>RSI(14): <b className={metrics.rsi > 70 ? 'down' : metrics.rsi < 30 ? 'up' : ''}>{metrics.rsi == null ? '—' : metrics.rsi.toFixed(1)}</b></span>
      <span>ATR(14): <b>{metrics.atr == null ? '—' : fmt(metrics.atr)}</b></span>
      <span>MACD: <b className={metrics.macd?.histogram >= 0 ? 'up' : 'down'}>{metrics.macd ? metrics.macd.histogram.toFixed(5) : '—'}</b></span>
      <span>Avg vol: <b>{metrics.volume ? fmt(metrics.volume) : '—'}</b></span>
      {showStochRsi && <span>Stoch RSI: <b>{metrics.stochRsi == null ? '—' : metrics.stochRsi.toFixed(1)}</b></span>}
      {showObv && <span>OBV: <b>{fmt(metrics.obv)}</b></span>}
      {showSupertrend && <span>Trend bias: <b>{metrics.supertrend || '—'}</b></span>}
      {marketCounts && <span>Listed: <b>{marketCounts[marketType] ?? '—'}</b></span>}
    </div>
    <div className="chart-ohlc-strip">
      <b>{symbol}</b>
      <span>O <strong>{activeCandle ? fmt(activeCandle[1]) : '—'}</strong></span>
      <span>H <strong className="up">{activeCandle ? fmt(activeCandle[2]) : '—'}</strong></span>
      <span>L <strong className="down">{activeCandle ? fmt(activeCandle[3]) : '—'}</strong></span>
      <span>C <strong>{activeCandle ? fmt(activeCandle[4]) : '—'}</strong></span>
      <span>V <strong>{activeCandle ? fmt(activeCandle[5]) : '—'}</strong></span>
      {ticker?.last != null && <strong className="chart-last-price">{fmt(ticker.last)}</strong>}
    </div>
    {error ? <div className="chart-error">{error}</div> : !geometry ? <div className="chart-wait">{loading ? 'Loading live OHLC candles…' : 'Waiting for exchange candle data…'}</div> :
      <div className="candlestick-svg-wrap">
        <svg viewBox="0 0 1000 420" preserveAspectRatio="none" role="img" aria-label={symbol + ' live candlestick chart'} onClick={(event) => { if (drawMode === 'off' || !geometry) return; const rect=event.currentTarget.getBoundingClientRect(); const px=(event.clientX-rect.left)/rect.width*1000; const py=(event.clientY-rect.top)/rect.height*420; const price=geometry.max-(py-geometry.top)/(geometry.priceBottom-geometry.top)*(geometry.max-geometry.min); if(drawMode==='horizontal') setDrawings(v=>[...v,{kind:'level',price}]); else setDrawings(v=>v.length%2===0?[...v,{kind:'start',x:px,price}]:[...v,{kind:'end',x:px,price}]); }} onMouseLeave={() => setCrosshair(null)} onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relative = (event.clientX - rect.left) / rect.width;
          const index = Math.max(0, Math.min(geometry.count - 1, Math.floor(((relative * 1000) - geometry.left) / (geometry.right - geometry.left) * geometry.count)));
          setCrosshair(index);
        }}>
          {calibratedPriceTicks(geometry.min, geometry.max, symbol).map((value) => {
            const y = geometry.y(value);
            return <g key={'pip-'+value}><line x1={geometry.left} y1={y} x2="925" y2={y} stroke="#263247" strokeDasharray="3 4"/><text x="935" y={y + 3.5} fill="#8392a8" fontSize="9.5">{fmt(value)}</text></g>;
          })}
          {geometry.rows.map((c, i) => {
            const up = c[4] >= c[1], color = up ? '#20c997' : '#f07883';
            const x = geometry.x(i), bodyTop = geometry.y(Math.max(c[1], c[4])), bodyBottom = geometry.y(Math.min(c[1], c[4]));
            const bodyHeight = Math.max(1.4, bodyBottom - bodyTop);
            const volHeight = c[5] / geometry.maxVol * volumeHeight;
            return <g key={c[0]}>
              <line x1={x} y1={geometry.y(c[2])} x2={x} y2={geometry.y(c[3])} stroke={color} strokeWidth="1.3"/>
              <rect x={x - candleWidth/2} y={bodyTop} width={candleWidth} height={bodyHeight} fill={color} stroke={color} rx=".5"/>
              {showVolume && <rect x={x - candleWidth/2} y={geometry.volumeBottom - volHeight} width={candleWidth} height={volHeight} fill={color} opacity=".42"/>}
              {i % Math.max(1, Math.floor(geometry.count / 7)) === 0 && <text x={x} y="405" textAnchor="middle" fill="#78889e" fontSize="10">{timeLabel(c[0], timeframe)}</text>}
            </g>;
          })}

          {showFvg && smartMoney.fairValueGaps.filter(z => z.end >= candles.length - geometry.count).map((z,i) => { const offset=candles.length-geometry.count; const x1=geometry.x(Math.max(0,z.start-offset)), x2=geometry.x(Math.min(geometry.count-1,z.end-offset)); const y1=geometry.y(z.top), y2=geometry.y(z.bottom); return <g key={'fvg'+i}><rect x={x1} y={Math.min(y1,y2)} width={Math.max(3,x2-x1)} height={Math.max(2,Math.abs(y2-y1))} fill={z.direction==='bullish'?'#20c997':'#f07883'} fillOpacity={z.mitigatedAt == null ? '.13' : '.045'} stroke={z.direction==='bullish'?'#20c997':'#f07883'} strokeOpacity={z.mitigatedAt == null ? '.55' : '.22'} strokeDasharray="3 3"/><text x={x1+3} y={Math.min(y1,y2)-3} fill={z.direction==='bullish'?'#20c997':'#f07883'} fontSize="9">{z.direction==='bullish'?'Bull FVG':'Bear FVG'}{z.mitigatedAt != null?' · filled':''}</text></g>; })}
          {showOrderBlocks && smartMoney.orderBlocks.filter(z => z.end >= candles.length - geometry.count).map((z,i) => { const offset=candles.length-geometry.count; const x1=geometry.x(Math.max(0,z.start-offset)), x2=geometry.x(Math.min(geometry.count-1,z.end-offset)); const y1=geometry.y(z.top), y2=geometry.y(z.bottom); return <g key={'ob'+i}><rect x={x1} y={Math.min(y1,y2)} width={Math.max(4,x2-x1)} height={Math.max(2,Math.abs(y2-y1))} fill={z.direction==='bullish'?'#20c997':'#f07883'} fillOpacity={z.mitigatedAt == null ? '.10' : '.04'} stroke={z.direction==='bullish'?'#20c997':'#f07883'} strokeWidth="1.2"/><text x={x1+3} y={Math.min(y1,y2)-3} fill={z.direction==='bullish'?'#20c997':'#f07883'} fontSize="9">{z.direction==='bullish'?'Bull OB':'Bear OB'}{z.mitigatedAt != null?' · invalidated':''}</text></g>; })}
          {showStructure && smartMoney.structureBreaks.filter(e => e.index >= candles.length - geometry.count).map((e,i) => { const x=geometry.x(e.index-(candles.length-geometry.count)), y=geometry.y(e.level); return <g key={'struct'+i}><line x1={geometry.left} y1={y} x2={x} y2={y} stroke={e.direction==='bullish'?'#20c997':'#f07883'} strokeWidth="1.2" strokeDasharray="5 3"/><text x={Math.max(geometry.left,x-42)} y={y+(e.direction==='bullish'?-5:12)} fill={e.direction==='bullish'?'#20c997':'#f07883'} fontSize="10">{e.kind} {e.direction==='bullish'?'↑':'↓'}</text></g>; })}
          {showSweeps && smartMoney.liquiditySweeps.filter(e => e.index >= candles.length - geometry.count).map((e,i) => { const x=geometry.x(e.index-(candles.length-geometry.count)), y=geometry.y(e.level); return <g key={'sweep'+i}><circle cx={x} cy={y} r="3.5" fill="#e5b85c"/><text x={x+4} y={y-6} fill="#e5b85c" fontSize="9">{e.direction==='buy-side'?'BSL sweep':'SSL sweep'}</text></g>; })}
          {showVwap && metrics.vwap && <line x1={geometry.left} y1={geometry.y(metrics.vwap)} x2={geometry.right} y2={geometry.y(metrics.vwap)} stroke="#38bdf8" strokeWidth="1.6" strokeDasharray="6 3"/>}
          {drawings.filter(d=>d.kind==='level').map((d,i)=><g key={'level'+i}><line x1={geometry.left} y1={geometry.y(d.price)} x2={geometry.right} y2={geometry.y(d.price)} stroke="#e5b85c" strokeDasharray="5 4"/><text x={geometry.left+5} y={geometry.y(d.price)-4} fill="#e5b85c" fontSize="10">S/R {fmt(d.price)}</text></g>)}
          {(alphaLevels || []).filter(level => Number.isFinite(Number(level.price))).map((level,i) => { const y=geometry.y(Number(level.price)); return <g key={'alpha-'+level.label+'-'+i}><line x1={geometry.left} y1={y} x2={geometry.right} y2={y} stroke={level.color || '#e5b85c'} strokeWidth="1.5" strokeDasharray="6 4"/><text x={geometry.left+6} y={y-5} fill={level.color || '#e5b85c'} fontSize="10">ALPHA {level.label}: {fmt(level.price)}</text></g>; })}
          {drawings.filter(d=>d.kind==='start').map((d,i)=>{const end=drawings.filter(x=>x.kind==='end')[i];return end?<line key={'trend'+i} x1={d.x} y1={geometry.y(d.price)} x2={end.x} y2={geometry.y(end.price)} stroke="#a78bfa" strokeWidth="2"/>:null;})}
          {showEma20 && <polyline points={geometry.points(metrics.ema20)} fill="none" stroke="#e5b85c" strokeWidth="1.7" vectorEffect="non-scaling-stroke"/>}
          {showEma50 && <polyline points={geometry.points(metrics.ema50)} fill="none" stroke="#9b8cf5" strokeWidth="1.7" vectorEffect="non-scaling-stroke"/>}
          {showBollinger && <><polyline points={geometry.points(metrics.bollinger.upper)} fill="none" stroke="#58a6ff" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/><polyline points={geometry.points(metrics.bollinger.lower)} fill="none" stroke="#58a6ff" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/></> }
          {crosshair !== null && <g><line x1={geometry.x(crosshair)} y1="10" x2={geometry.x(crosshair)} y2="385" stroke="#a9b7c9" strokeDasharray="3 4"/><line x1="12" y1={geometry.y(geometry.rows[crosshair][4])} x2="925" y2={geometry.y(geometry.rows[crosshair][4])} stroke="#a9b7c9" strokeDasharray="3 4"/></g>}
        </svg>
      </div>}
    <div className="market-context-panel">
      <div className="market-context-heading"><b>MARKET CONFLUENCE INTELLIGENCE</b><span>{marketContext?.generatedAt ? 'Updated ' + new Date(marketContext.generatedAt).toLocaleTimeString() : 'Awaiting evidence'}</span></div>
      {marketContext ? <>
        <div className="market-context-summary"><strong className={marketContext.score.score > 0 ? 'up' : marketContext.score.score < 0 ? 'down' : ''}>{marketContext.score.direction.toUpperCase()}</strong><span>Evidence score {marketContext.score.score}</span><span>Confidence: {marketContext.score.confidence}</span><span>20-bar momentum: {marketContext.market.priceChangePct}%</span><span>Relative volume: {marketContext.market.volumeChangePct == null ? '—' : marketContext.market.volumeChangePct + '%'}</span><span>Global crypto market 24h: {marketContext.broadContext.globalMarketCapChange24hPct == null ? '—' : marketContext.broadContext.globalMarketCapChange24hPct.toFixed(2) + '%'}</span><span>Order-book imbalance: {marketContext.market.orderBookImbalancePct == null ? 'Not supported' : marketContext.market.orderBookImbalancePct + '%'}</span><span>Funding: {marketContext.market.fundingRate == null ? 'Not supported' : (marketContext.market.fundingRate * 100).toFixed(4) + '%'}</span></div>
        <div className="market-context-evidence">Timeframes: {marketContext.multiTimeframe.map((item) => item.timeframe + ' ' + item.bias + (item.changePct == null ? '' : ' (' + item.changePct + '%)')).join(' · ')}</div>
        <div className="market-context-evidence">{marketContext.score.evidence.map((item) => <span key={item.factor}>{item.factor}: <b>{item.contribution > 0 ? '+' : ''}{item.contribution}</b></span>)}</div>
        <div className="market-context-sources">{marketContext.sources.map((item) => <span key={item.name}><i className={item.status === 'live' ? 'source-live' : 'source-down'}/>{item.name}: {item.status}</span>)}</div>
        <p>{marketContext.limitations[0]} {marketContext.limitations[1]}</p>
      </> : <p>{contextError || 'Calculating exchange and global market context…'}</p>}
    </div>
    <div className="smc-event-strip">
      <div><small>FVG zones</small><strong>{smartMoney.fairValueGaps.length}</strong></div>
      <div><small>Liquidity sweeps</small><strong>{smartMoney.liquiditySweeps.length}</strong></div>
      <div><small>BOS / CHoCH</small><strong>{smartMoney.structureBreaks.length}</strong></div>
      <div><small>Order blocks</small><strong>{smartMoney.orderBlocks.length}</strong></div>
      <div className="smc-last-event"><small>Latest structure</small><strong>{smartMoney.structureBreaks.length ? smartMoney.structureBreaks[smartMoney.structureBreaks.length - 1].kind + ' · ' + smartMoney.structureBreaks[smartMoney.structureBreaks.length - 1].direction : 'Waiting for confirmation'}</strong></div>
    </div>
    <div className="smc-method-note">SMC analysis uses closed candles and confirmed swing points. Zones are rule-based technical estimates, not verified institutional orders or trade recommendations.</div>
    <div className="chart-footer">
      <span>{candles.length} candles · {timeframe} · Auto-refresh 20s · SMC uses closed candles · BOS/CHoCH {smartMoney.structureBreaks.length} · FVG {smartMoney.fairValueGaps.length}</span>
      <button type="button" onClick={() => setDrawings([])}>Clear drawings</button>
      <span>EMA 20 <i className="ema20-key"/> EMA 50 <i className="ema50-key"/> Bullish <i className="bull-key"/> Bearish <i className="bear-key"/></span>
    </div>
  </section>;
}
