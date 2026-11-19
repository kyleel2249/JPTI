import React, { useEffect, useMemo, useState } from 'react';

export default function ExchangeConnectivity() {
  const [health, setHealth] = useState(null);
  const [exchanges, setExchanges] = useState([]);
  const [exchange, setExchange] = useState('binance');
  const [ticker, setTicker] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = useMemo(() => exchanges.find((item) => item.id === exchange), [exchanges, exchange]);

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
        const response = await fetch(`/api/exchanges/${exchange}/ticker/BTC-USDT`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ticker request failed');
        if (active) { setTicker(data); setError(''); }
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
    <div className="exchange-foot">
      <span>{loading ? 'Refreshing exchange ticker…' : health ? `Mode: ${health.mode.toUpperCase()} · refreshed every 20 seconds` : 'Start the JPTI API service to connect.'}</span>
      {error && <span className="exchange-error">{error}</span>}
    </div>
  </section>;
}
