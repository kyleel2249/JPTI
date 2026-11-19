import React, { useEffect, useMemo, useState } from 'react';

const TIMEFRAMES = [
  ['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['30m', '30m'],
  ['1h', '1H'], ['2h', '2H'], ['4h', '4H'], ['6h', '6H'],
  ['12h', '12H'], ['1d', '1D'], ['1w', '1W'], ['1M', '1M']
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
const timeLabel = (stamp, timeframe) => {
  const date = new Date(stamp);
  return ['1d', '1w', '1M'].includes(timeframe)
    ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function LiveCandlestickChart({ exchange, symbol, onSymbolChange }) {
  const [timeframe, setTimeframe] = useState('1h');
  const [candles, setCandles] = useState([]);
  const [ticker, setTicker] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [crosshair, setCrosshair] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const encodedSymbol = symbol.replace('/', '-');
      const [candleResponse, tickerResponse] = await Promise.all([
        fetch('/api/exchanges/' + exchange + '/ohlcv/' + encodedSymbol + '?timeframe=' + timeframe + '&limit=200'),
        fetch('/api/exchanges/' + exchange + '/ticker/' + encodedSymbol)
      ]);
      const [candleData, tickerData] = await Promise.all([candleResponse.json(), tickerResponse.json()]);
      if (!candleResponse.ok) throw new Error(candleData.error || 'Candlestick data unavailable for this market and timeframe.');
      setCandles((candleData.candles || []).filter((row) => row.length >= 6).map((row) => row.map(Number)));
      setError('');
      if (tickerResponse.ok) setTicker(tickerData);
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
        const [candleResponse, tickerResponse] = await Promise.all([
          fetch('/api/exchanges/' + exchange + '/ohlcv/' + encodedSymbol + '?timeframe=' + timeframe + '&limit=200'),
          fetch('/api/exchanges/' + exchange + '/ticker/' + encodedSymbol)
        ]);
        const [candleData, tickerData] = await Promise.all([candleResponse.json(), tickerResponse.json()]);
        if (!active) return;
        if (!candleResponse.ok) throw new Error(candleData.error || 'Candlestick data unavailable for this market and timeframe.');
        setCandles((candleData.candles || []).filter((row) => row.length >= 6).map((row) => row.map(Number)));
        if (tickerResponse.ok) setTicker(tickerData);
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
      volume: candles.slice(-20).reduce((sum, c) => sum + c[5], 0) / Math.min(20, candles.length)
    };
  }, [candles]);

  const geometry = useMemo(() => {
    if (!candles.length) return null;
    const count = Math.max(25, Math.min(candles.length, Math.floor(candles.length / zoom)));
    const rows = candles.slice(-count);
    const min = Math.min(...rows.map((c) => c[3]));
    const max = Math.max(...rows.map((c) => c[2]));
    const padding = (max - min || max * 0.002 || 1) * 0.09;
    const low = min - padding, high = max + padding;
    const left = 12, right = 920, top = 18, priceBottom = 300, volumeBottom = 378;
    const x = (i) => left + (i + 0.5) * ((right - left) / rows.length);
    const y = (price) => top + ((high - price) / (high - low)) * (priceBottom - top);
    const maxVol = Math.max(1, ...rows.map((c) => c[5]));
    const points = (values) => values.slice(candles.length - count).map((value, i) => Number.isFinite(value) ? x(i) + ',' + y(value) : null).filter(Boolean).join(' ');
    return { rows, count, min: low, max: high, left, right, top, priceBottom, volumeBottom, x, y, maxVol, points };
  }, [candles, zoom]);

  const activeCandle = crosshair !== null && geometry ? geometry.rows[crosshair] : metrics.last;
  const candleWidth = geometry ? Math.max(2, Math.min(11, (geometry.right - geometry.left) / geometry.count * 0.66)) : 4;

  return <section className="panel exchange-connect trading-chart-panel">
    <div className="panelhead">
      <span><b>Live market chart</b><small>OHLCV exchange data · {exchange.toUpperCase()}</small></span>
      <i className="running">LIVE MARKET DATA</i>
    </div>
    <div className="chart-toolbar">
      <label htmlFor="jpti-symbol">Market</label>
      <select id="jpti-symbol" value={symbol} onChange={(e) => onSymbolChange(e.target.value)}>
        {SYMBOLS.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <div className="timeframe-list" role="group" aria-label="Chart timeframe">
        {TIMEFRAMES.map(([value, label]) => <button key={value} className={timeframe === value ? 'active' : ''} onClick={() => setTimeframe(value)}>{label}</button>)}
      </div>
      <div className="chart-actions">
        <button onClick={() => setZoom((v) => Math.min(4, v * 1.35))} title="Zoom in">＋</button>
        <button onClick={() => setZoom((v) => Math.max(0.5, v / 1.35))} title="Zoom out">－</button>
        <button onClick={() => setZoom(1)} title="Fit all candles">Fit</button>
        <button onClick={load} title="Refresh chart">{loading ? '…' : '↻'}</button>
      </div>
    </div>
    <div className="chart-indicator-controls">
      <label><input type="checkbox" checked={showEma20} onChange={(e) => setShowEma20(e.target.checked)}/> EMA 20</label>
      <label><input type="checkbox" checked={showEma50} onChange={(e) => setShowEma50(e.target.checked)}/> EMA 50</label>
      <label><input type="checkbox" checked={showBollinger} onChange={(e) => setShowBollinger(e.target.checked)}/> Bollinger</label>
      <label><input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)}/> Volume</label>
      <span>RSI(14): <b className={metrics.rsi > 70 ? 'down' : metrics.rsi < 30 ? 'up' : ''}>{metrics.rsi == null ? '—' : metrics.rsi.toFixed(1)}</b></span>
      <span>ATR(14): <b>{metrics.atr == null ? '—' : fmt(metrics.atr)}</b></span>
      <span>MACD: <b className={metrics.macd?.histogram >= 0 ? 'up' : 'down'}>{metrics.macd ? metrics.macd.histogram.toFixed(5) : '—'}</b></span>
      <span>Avg vol: <b>{metrics.volume ? fmt(metrics.volume) : '—'}</b></span>
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
        <svg viewBox="0 0 1000 420" preserveAspectRatio="none" role="img" aria-label={symbol + ' live candlestick chart'} onMouseLeave={() => setCrosshair(null)} onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relative = (event.clientX - rect.left) / rect.width;
          const index = Math.max(0, Math.min(geometry.count - 1, Math.floor(((relative * 1000) - geometry.left) / (geometry.right - geometry.left) * geometry.count)));
          setCrosshair(index);
        }}>
          {[0,1,2,3,4].map((i) => {
            const value = geometry.max - (geometry.max - geometry.min) * i / 4;
            const y = geometry.y(value);
            return <g key={i}><line x1={geometry.left} y1={y} x2="925" y2={y} stroke="#263247" strokeDasharray="4 5"/><text x="935" y={y + 4} fill="#8392a8" fontSize="11">{fmt(value)}</text></g>;
          })}
          {geometry.rows.map((c, i) => {
            const up = c[4] >= c[1], color = up ? '#20c997' : '#f07883';
            const x = geometry.x(i), bodyTop = geometry.y(Math.max(c[1], c[4])), bodyBottom = geometry.y(Math.min(c[1], c[4]));
            const bodyHeight = Math.max(1.4, bodyBottom - bodyTop);
            const volHeight = c[5] / geometry.maxVol * 65;
            return <g key={c[0]}>
              <line x1={x} y1={geometry.y(c[2])} x2={x} y2={geometry.y(c[3])} stroke={color} strokeWidth="1.3"/>
              <rect x={x - candleWidth/2} y={bodyTop} width={candleWidth} height={bodyHeight} fill={color} stroke={color} rx=".5"/>
              {showVolume && <rect x={x - candleWidth/2} y={geometry.volumeBottom - volHeight} width={candleWidth} height={volHeight} fill={color} opacity=".42"/>}
              {i % Math.max(1, Math.floor(geometry.count / 7)) === 0 && <text x={x} y="405" textAnchor="middle" fill="#78889e" fontSize="10">{timeLabel(c[0], timeframe)}</text>}
            </g>;
          })}
          {showEma20 && <polyline points={geometry.points(metrics.ema20)} fill="none" stroke="#e5b85c" strokeWidth="1.7" vectorEffect="non-scaling-stroke"/>}
          {showEma50 && <polyline points={geometry.points(metrics.ema50)} fill="none" stroke="#9b8cf5" strokeWidth="1.7" vectorEffect="non-scaling-stroke"/>}
          {showBollinger && <><polyline points={geometry.points(metrics.bollinger.upper)} fill="none" stroke="#58a6ff" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/><polyline points={geometry.points(metrics.bollinger.lower)} fill="none" stroke="#58a6ff" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/></> }
          {crosshair !== null && <g><line x1={geometry.x(crosshair)} y1="10" x2={geometry.x(crosshair)} y2="385" stroke="#a9b7c9" strokeDasharray="3 4"/><line x1="12" y1={geometry.y(geometry.rows[crosshair][4])} x2="925" y2={geometry.y(geometry.rows[crosshair][4])} stroke="#a9b7c9" strokeDasharray="3 4"/></g>}
        </svg>
      </div>}
    <div className="chart-footer">
      <span>{candles.length} candles · {timeframe} · {loading ? 'Updating…' : 'Auto-refresh 20s'}</span>
      <span>EMA 20 <i className="ema20-key"/> EMA 50 <i className="ema50-key"/> Bullish <i className="bull-key"/> Bearish <i className="bear-key"/></span>
    </div>
  </section>;
}
