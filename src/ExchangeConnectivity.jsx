import React, { useEffect, useMemo, useState } from 'react';

export default function ExchangeConnectivity() {
  const [health, setHealth] = useState(null);
  const [exchanges, setExchanges] = useState([]);
  const [exchange, setExchange] = useState('binance');
  const [ticker, setTicker] = useState(null);
  const [candles, setCandles] = useState([]);
  const [chartError, setChartError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = useMemo(() => exchanges.find((item) => item.id === exchange), [exchanges, exchange]);
  const chartPoints = useMemo(() => {
    const values = candles.map((candle) => Number(candle[4])).filter((value) => Number.isFinite(value));
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values.map((value, index) => (index / (values.length - 1) * 760) + ',' + (140 - ((value - min) / range) * 120)).join(' ');
  }, [candles]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/health').then((r) => { if (!r.ok) throw new Error('Gateway is not responding'); return r.json(); }),
      fetch('/api/exchanges').then((r) => { if (!r.ok) throw new Error('Exchange catalog unavailable'); return r.json(); })
    ]).then(([status, catalog]) => {
      if (!active) return;
      setHealth(status);
      setExchanges(catalog.exchanges || []);
      setError('');
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const responses = await Promise.all([
          fetch('/api/exchanges/' + exchange + '/ticker/BTC-USDT'),
          fetch('/api/exchanges/' + exchange + '/ohlcv/BTC-USDT?timeframe=1h&limit=120')
        ]);
        const data = await Promise.all(responses.map((response) => response.json()));
        if (!responses[0].ok) throw new Error(data[0].error || 'Ticker request failed');
        if (active) { setTicker(data[0]); setError(''); }
        if (active && responses[1].ok) { setCandles(data[1].candles || []); setChartError(''); }
        else if (active) { setCandles([]); setChartError(data[1].error || 'Live candles unavailable for this exchange.'); }
      } catch (e) {
        if (active) { setTicker(null); setError(e.message); }
      } finally { if (active) setLoading(false); }
    };
    if (health) {
      load();
      const timer = setInterval(load, 20000);
      return () => { active = false; clearInterval(timer); };
    }
    return () => { active = false; };
  }, [exchange, health]);

  return <section className="panel exchange-connect">
    <div className="panelhead">
      <span><b>Multi-exchange connectivity</b><small>CCXT unified adapter · live public market data</small></span>
      <i className={health ? 'running' : 'standby'}>{health ? 'GATEWAY ONLINE' : 'CHECKING GATEWAY'}</i>
    </div>
    <div className="exchange-controls">
      <label htmlFor="jpti-exchange">Exchange</label>
      <select id="jpti-exchange" value={exchange} onChange={(e) => setExchange(e.target.value)}>
        {(exchanges.length ? exchanges : [{id:'binance',name:'Binance'}]).map((item) =>
          <option key={item.id} value={item.id}>{item.name || item.id}</option>
        )}
      </select>
      <span className={selected?.configured ? 'connected' : 'not-connected'}>
        {selected?.configured ? 'Private API configured' : 'Public data only'}
      </span>
    </div>
    <div className="exchange-ticker">
      <span><small>BTC/USDT · {exchange.toUpperCase()}</small><strong>{ticker?.last ? Number(ticker.last).toLocaleString(undefined,{maximumFractionDigits:8}) : '—'}</strong></span>
      <span><small>24H CHANGE</small><strong className={Number(ticker?.percentage) >= 0 ? 'up' : 'down'}>{ticker?.percentage == null ? '—' : `${Number(ticker.percentage).toFixed(2)}%`}</strong></span>
      <span><small>24H QUOTE VOLUME</small><strong>{ticker?.quoteVolume == null ? '—' : Number(ticker.quoteVolume).toLocaleString(undefined,{maximumFractionDigits:0})}</strong></span>
    </div>
    <div className="live-candle-chart">
      <div className="live-chart-heading"><b>BTC/USDT · 1H candles</b><span>{candles.length ? candles.length + ' live candles' : 'Waiting for candle data'}</span></div>
      {chartPoints ? <svg viewBox="0 0 760 150" preserveAspectRatio="none" role="img" aria-label="Live hourly BTC USDT closing-price chart">
        {[20,60,100,140].map((y) => <line key={y} x1="0" y1={y} x2="760" y2={y} stroke="#263247" strokeDasharray="4 5" />)}
        <polyline points={chartPoints} fill="none" stroke="#20c997" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg> : <div className="chart-wait">{chartError || 'Waiting for live exchange candles…'}</div>}
    </div>
    <div className="exchange-foot">
      <span>{loading ? 'Refreshing exchange ticker…' : health ? `Mode: ${health.mode.toUpperCase()} · refreshed every 20 seconds` : 'Start the JPTI API service to connect.'}</span>
      {error && <span className="exchange-error">{error}</span>}
    </div>
  </section>;
}
