import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ExchangeConnectivity from './ExchangeConnectivity.jsx';
import FinancialIntelligence from './FinancialIntelligence.jsx';
import {
  Activity, BarChart3, Bell, Blocks, Bot, BrainCircuit, CandlestickChart,
  ChevronRight, CircleHelp, Command, Cpu, Database, Gauge, Globe2,
  LayoutDashboard, Menu, Network, Newspaper, Radio, RefreshCw, Search,
  Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Wallet, X, Zap
} from 'lucide-react';

const navigation = [
  { label: 'Overview', icon: LayoutDashboard, group: 'COMMAND' },
  { label: 'Spot & Markets', icon: CandlestickChart, group: 'MARKETS' },
  { label: 'Futures', icon: Activity, group: 'MARKETS' },
  { label: 'AI Intelligence', icon: BrainCircuit, group: 'INTELLIGENCE' },
  { label: 'Market Scanner', icon: Search, group: 'INTELLIGENCE' },
  { label: 'Financial & On-chain', icon: Blocks, group: 'INTELLIGENCE' },
  { label: 'News & Events', icon: Newspaper, group: 'INTELLIGENCE' },
  { label: 'Portfolio & Ledger', icon: Wallet, group: 'OPERATIONS' },
  { label: 'Risk Management', icon: ShieldCheck, group: 'OPERATIONS' },
  { label: 'Trading Bots', icon: Bot, group: 'OPERATIONS' },
  { label: 'Backtesting Lab', icon: BarChart3, group: 'RESEARCH' },
  { label: 'Forecast & Strategy', icon: Gauge, group: 'RESEARCH' },
  { label: 'Walk-Forward Lab', icon: SlidersHorizontal, group: 'RESEARCH' },
  { label: 'Calendar & Sessions', icon: Globe2, group: 'RESEARCH' }
];

const fmt = (value) => value == null ? '—' : Number(value).toLocaleString();
const time = (value) => value ? new Date(value).toLocaleTimeString() : 'Awaiting first run';

function StatusPill({ status }) {
  const good = ['live', 'registry-checked', 'ready', 'ok'].includes(status);
  const warn = ['partial', 'waiting-for-watchlist', 'waiting-for-prerequisites', 'starting', 'not-started'].includes(status);
  return <span className={'status-pill ' + (good ? 'good' : warn ? 'warn' : 'bad')}><i />{String(status || 'unknown').replaceAll('-', ' ')}</span>;
}

function App() {
  const [page, setPage] = useState('Overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [health, setHealth] = useState(null);
  const [operations, setOperations] = useState(null);
  const [providers, setProviders] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [query, setQuery] = useState('');
  const [newsQuery, setNewsQuery] = useState('financial markets OR central bank OR cryptocurrency');
  const [newsData, setNewsData] = useState([]);
  const [newsError, setNewsError] = useState('');
  const [newsLoading, setNewsLoading] = useState(false);
  const [quoteSymbol, setQuoteSymbol] = useState('AAPL');
  const [quoteConsensus, setQuoteConsensus] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [crossVenueSymbol, setCrossVenueSymbol] = useState('BTC/USDT');
  const [crossVenueData, setCrossVenueData] = useState(null);
  const [crossVenueLoading, setCrossVenueLoading] = useState(false);
  const [crossVenueError, setCrossVenueError] = useState('');
  const [forecastData, setForecastData] = useState(null);
  const [forecastError, setForecastError] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastExchange, setForecastExchange] = useState('binance');
  const [forecastTimeframe, setForecastTimeframe] = useState('1h');
  const [labData, setLabData] = useState(null);
  const [labError, setLabError] = useState('');
  const [labLoading, setLabLoading] = useState(false);
  const [labTrainBars, setLabTrainBars] = useState(300);
  const [labTestBars, setLabTestBars] = useState(100);
  const [streamData, setStreamData] = useState(null);
  const [portfolioToken, setPortfolioToken] = useState('');
  const [portfolioData, setPortfolioData] = useState(null);
  const [portfolioError, setPortfolioError] = useState('');
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const paths = ['/api/health', '/api/operations/overview', '/api/providers', '/api/operations/ledger/summary', '/api/operations/events?limit=12'];
      const responses = await Promise.all(paths.map((path) => fetch(path, { cache: 'no-store' })));
      const payloads = await Promise.all(responses.map((response) => response.json()));
      const failed = responses.findIndex((response) => !response.ok);
      if (failed >= 0) throw new Error(payloads[failed]?.error || 'JPTI service endpoint unavailable');
      setHealth(payloads[0]);
      setOperations(payloads[1]);
      setProviders(payloads[2]);
      setLedger(payloads[3]);
      setEvents(payloads[4].events || []);
      setLoadError('');
      setLastRefresh(new Date().toISOString());
    } catch (error) {
      setLoadError(error.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  const loadNews = useCallback(async (event) => {
    if (event) event.preventDefault();
    setNewsLoading(true); setNewsError('');
    try {
      const response = await fetch('/api/providers/news/search?q=' + encodeURIComponent(newsQuery), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'News search unavailable');
      setNewsData(data.articles || []);
    } catch (error) { setNewsError(error.message); }
    finally { setNewsLoading(false); }
  }, [newsQuery]);

  useEffect(() => {
    if (page === 'News & Events' && newsData.length === 0) loadNews();
  }, [page, newsData.length, loadNews]);

  const loadQuoteConsensus = useCallback(async (event) => {
    if (event) event.preventDefault();
    setQuoteLoading(true); setQuoteError('');
    try {
      const normalizedSymbol = quoteSymbol.trim().toUpperCase();
      const response = await fetch('/api/providers/consensus/quote/' + encodeURIComponent(normalizedSymbol), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Cross-provider quote check failed');
      setQuoteConsensus(data);
    } catch (error) { setQuoteError(error.message); }
    finally { setQuoteLoading(false); }
  }, [quoteSymbol]);

  const loadCrossVenue = useCallback(async (event) => {
    if (event) event.preventDefault();
    setCrossVenueLoading(true); setCrossVenueError('');
    try {
      const params = new URLSearchParams({ symbol: crossVenueSymbol.trim().toUpperCase() });
      const response = await fetch('/api/exchanges/compare/ticker?' + params.toString(), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Cross-exchange comparison failed');
      setCrossVenueData(data);
    } catch (error) { setCrossVenueError(error.message); }
    finally { setCrossVenueLoading(false); }
  }, [crossVenueSymbol]);

  const loadForecast = useCallback(async (event) => {
    if (event) event.preventDefault();
    setForecastLoading(true); setForecastError('');
    try {
      const url = '/api/advanced/forecast/' + encodeURIComponent(forecastExchange) + '/' + encodeURIComponent(symbol) + '?timeframe=' + encodeURIComponent(forecastTimeframe);
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Forecast unavailable');
      setForecastData(data);
    } catch (error) { setForecastError(error.message); }
    finally { setForecastLoading(false); }
  }, [forecastExchange, symbol, forecastTimeframe]);

  const runWalkForward = useCallback(async (event) => {
    if (event) event.preventDefault();
    setLabLoading(true); setLabError('');
    try {
      const params = new URLSearchParams({ timeframe: forecastTimeframe, limit: '1000', trainBars: String(labTrainBars), testBars: String(labTestBars), stepBars: String(labTestBars), feeBps: '10' });
      const url = '/api/advanced/lab/walk-forward/' + encodeURIComponent(forecastExchange) + '/' + encodeURIComponent(symbol) + '?' + params.toString();
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Walk-forward research failed');
      setLabData(data);
    } catch (error) { setLabError(error.message); }
    finally { setLabLoading(false); }
  }, [forecastExchange, forecastTimeframe, symbol, labTrainBars, labTestBars]);

  const loadPortfolioAccounting = useCallback(async (event) => {
    if (event) event.preventDefault();
    setPortfolioLoading(true); setPortfolioError('');
    try {
      const response = await fetch('/api/advanced/portfolio/accounting', { headers: { 'x-jpti-api-token': portfolioToken }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Portfolio accounting unavailable');
      setPortfolioData(data);
    } catch (error) { setPortfolioError(error.message); }
    finally { setPortfolioLoading(false); }
  }, [portfolioToken]);

  useEffect(() => {
    if (page !== 'Forecast & Strategy') { setStreamData(null); return undefined; }
    const source = new EventSource('/api/advanced/stream/' + encodeURIComponent(forecastExchange) + '/' + encodeURIComponent(symbol) + '?intervalMs=2000');
    source.addEventListener('intelligence', event => { try { setStreamData(JSON.parse(event.data)); } catch {} });
    return () => source.close();
  }, [page, forecastExchange, symbol]);

  const filteredNav = useMemo(() => navigation.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [query]);
  const jobById = useMemo(() => Object.fromEntries((operations?.jobs || []).map((job) => [job.id, job])), [operations]);
  const configuredProviders = (providers?.providers || []).filter((provider) => provider.configured).length;
  const marketJob = jobById['market-monitor'];
  const gatewayOnline = health?.status === 'ok';
  const activeNav = (label) => { setPage(label); setMobileOpen(false); };

  const pageDescription = {
    'Overview': 'A live operational view across markets, intelligence sources and risk controls.',
    'Spot & Markets': 'Live multi-exchange market data and technical analysis.',
    'Futures': 'Derivatives market discovery. Contract availability depends on exchange support.',
    'AI Intelligence': 'Signal evidence, market context and explainable analysis.',
    'Market Scanner': 'Configure market watchlists for scheduled live ticker monitoring.',
    'Financial & On-chain': 'Macro, digital-asset, provider and wallet intelligence.',
    'News & Events': 'News discovery and event context from connected sources.',
    'Portfolio & Ledger': 'Append-only transaction events and reconciliation readiness.',
    'Risk Management': 'Execution safeguards, service readiness and risk policy.',
    'Trading Bots': 'Agent orchestration status. Live execution remains protected.',
    'Backtesting Lab': 'Strategy research and historical validation workspace.',
    'Forecast & Strategy': 'Statistical range forecasts, market microstructure, derivatives and research validation.',
    'Walk-Forward Lab': 'Rolling parameter selection, out-of-sample validation and strategy robustness research.',
    'Calendar & Sessions': 'Economic releases, market sessions and scheduled events.'
  };

  const renderOperations = () => (
    <div className="ops-grid">
      {(operations?.jobs || []).map((job) => {
        const Icon = job.id === 'market-monitor' ? Radio : job.id === 'provider-health' ? Network : job.id === 'reconciliation' ? Database : job.id === 'investor-monitor' ? Wallet : job.id === 'market-maker' ? Activity : job.id === 'news-monitor' ? Newspaper : Blocks;
        return <article className="ops-card" key={job.id}>
          <div className="ops-card-top"><span className="ops-icon"><Icon size={15}/></span><StatusPill status={job.status}/></div>
          <b>{job.label}</b>
          <p>{job.detail}</p>
          <div className="ops-meta"><span>Interval <strong>{job.intervalSeconds}s</strong></span><span>Last run <strong>{time(job.lastRunAt)}</strong></span></div>
        </article>;
      })}
    </div>
  );

  const renderOverview = () => (
    <>
      <div className="hero-grid">
        <section className="hero-card">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <div className="hero-kicker"><span className="pulse-dot"/> INTELLIGENCE SYSTEM / ONLINE WORKSPACE</div>
          <h2>See the market.<br/><em>Understand the signal.</em></h2>
          <p>One command surface for multi-exchange data, on-chain activity, macro context and disciplined execution.</p>
          <div className="hero-actions"><button className="primary-action" onClick={() => activeNav('Spot & Markets')}><CandlestickChart size={15}/> Open trading terminal <ChevronRight size={14}/></button><button className="ghost-action" onClick={refresh}><RefreshCw size={14}/> Sync intelligence</button></div>
          <div className="hero-foot"><span><i/> PAPER-FIRST SAFETY</span><span>BUILD 0.3 · COMMAND CENTER</span></div>
        </section>
        <section className="system-card">
          <div className="section-label"><span>SYSTEM TELEMETRY</span><Cpu size={15}/></div>
          <div className="system-state"><div className={'system-ring ' + (gatewayOnline ? 'online' : 'offline')}><Activity size={24}/></div><div><b>{gatewayOnline ? 'Gateway operational' : 'Gateway unavailable'}</b><small>{health?.mode ? health.mode.toUpperCase() + ' MODE' : 'Waiting for API service'}</small></div></div>
          <div className="telemetry-line"><span>API gateway</span><StatusPill status={gatewayOnline ? 'ok' : 'offline'}/></div>
          <div className="telemetry-line"><span>Configured providers</span><b>{providers ? configuredProviders + ' / ' + providers.providers.length : '—'}</b></div>
          <div className="telemetry-line"><span>Scheduler</span><StatusPill status={operations?.schedulerEnabled ? 'ready' : 'disabled'}/></div>
          <div className="telemetry-line"><span>Uptime</span><b>{operations ? Math.floor(operations.uptimeSeconds / 60) + 'm ' + operations.uptimeSeconds % 60 + 's' : '—'}</b></div>
          <small className="telemetry-foot">Updated {time(lastRefresh)}</small>
        </section>
      </div>

      <div className="metric-grid">
        <article className="metric-card"><div><span>DATA PROVIDERS</span><Network size={16}/></div><strong>{providers ? configuredProviders : '—'}<small> / {providers?.providers?.length || '—'}</small></strong><p>Credentials or public feeds configured</p><div className="metric-track"><i style={{width: providers?.providers?.length ? (configuredProviders / providers.providers.length * 100) + '%' : '0%'}}/></div></article>
        <article className="metric-card"><div><span>LIVE WATCHLIST</span><Radio size={16}/></div><strong>{marketJob?.lastSnapshot?.length ?? '—'}</strong><p>{marketJob?.status === 'live' ? 'Markets sampled by scheduler' : 'Configure JPTI_MONITOR_MARKETS'}</p><div className="metric-track cyan"><i style={{width: marketJob?.lastSnapshot?.length ? '70%' : '0%'}}/></div></article>
        <article className="metric-card"><div><span>LEDGER EVENTS</span><Database size={16}/></div><strong>{fmt(ledger?.eventCount)}</strong><p>Persisted transaction events · not PnL</p><div className="metric-track violet"><i style={{width: ledger?.eventCount ? '42%' : '0%'}}/></div></article>
        <article className="metric-card"><div><span>EXECUTION SAFETY</span><ShieldCheck size={16}/></div><strong className="safe-word">PROTECTED</strong><p>Live orders remain disabled by default</p><div className="safety-caption"><i/> AUTHORIZATION REQUIRED</div></article>
      </div>

      <div className="section-heading"><div><span className="eyebrow">LIVE MARKET WORKSPACE</span><h3>Market intelligence terminal</h3><p>Exchange-fed prices and candles. Values remain blank until a provider responds.</p></div><span className="section-tag"><span className="pulse-dot"/> EXCHANGE DATA</span></div>
      <ExchangeConnectivity symbol={symbol} onSymbolChange={setSymbol}/>
      <section className="glass-panel quote-consensus-panel">
        <div className="panel-title"><div><span className="eyebrow">CROSS-SOURCE PRICE VALIDATION</span><h3>Multi-provider quote consensus</h3></div><span className="live-tag">READ-ONLY INTELLIGENCE</span></div>
        <p className="subtle-note">Compare independent provider observations, inspect source timestamps and identify outliers. This is not an executable consolidated quote.</p>
        <form className="quote-consensus-search" onSubmit={loadQuoteConsensus}>
          <input value={quoteSymbol} onChange={(event) => setQuoteSymbol(event.target.value)} placeholder="Ticker symbol, e.g. AAPL"/>
          <button disabled={quoteLoading || !quoteSymbol.trim()}>{quoteLoading ? 'Checking sources…' : 'Run cross-check'}</button>
        </form>
        {quoteError && <p className="quote-error">{quoteError}</p>}
        {quoteConsensus && <>
          <div className="quote-consensus-stats">
            <div><span>CONSENSUS MIDPOINT</span><b>{quoteConsensus.consensusPrice == null ? 'Unavailable' : Number(quoteConsensus.consensusPrice).toLocaleString(undefined,{maximumFractionDigits:6}) + (quoteConsensus.currency ? ' ' + quoteConsensus.currency : '')}</b></div>
            <div><span>VALID SOURCES</span><b>{quoteConsensus.sourceCount}</b></div>
            <div><span>PRICE DISPERSION</span><b>{quoteConsensus.spreadPercent == null ? '—' : Number(quoteConsensus.spreadPercent).toFixed(3) + '%'}</b></div>
            <div><span>ASSESSMENT</span><b>{String(quoteConsensus.confidence || 'unavailable').replaceAll('-', ' ')}</b></div>
          </div>
          <div className="quote-source-list">{(quoteConsensus.providerResults || []).map((item) => {
            const observation = (quoteConsensus.sources || []).find((source) => source.provider === item.provider);
            return <div key={item.provider}><span>{item.provider.toUpperCase()}</span><b>{observation ? Number(observation.price).toLocaleString(undefined,{maximumFractionDigits:6}) : item.status}</b><small>{observation ? new Date(observation.timestamp).toLocaleString() + (observation.outlier ? ' · OUTLIER REVIEW' : '') + (observation.stale ? ' · STALE' : '') : item.error || 'No usable quote'}</small></div>;
          })}</div>
          {quoteConsensus.currencyConflict && <p className="quote-error">Currency mismatch detected. JPTI withheld a combined consensus value.</p>}
          <p className="subtle-note">{quoteConsensus.note}</p>
        </>}
      </section>


      <section className="glass-panel quote-consensus-panel cross-venue-panel">
        <div className="panel-title"><div><span className="eyebrow">MULTI-EXCHANGE MARKET MICROSTRUCTURE</span><h3>Cross-venue spread scanner</h3></div><span className="live-tag">PUBLIC TICKERS</span></div>
        <p className="subtle-note">Compares live top-of-book snapshots across Binance, Bitget, Bybit and OKX where the selected market is listed. Indicative only; fees, depth and execution risk are excluded.</p>
        <form className="quote-consensus-search" onSubmit={loadCrossVenue}>
          <input value={crossVenueSymbol} onChange={(event) => setCrossVenueSymbol(event.target.value)} placeholder="Market symbol, e.g. BTC/USDT"/>
          <button disabled={crossVenueLoading || !crossVenueSymbol.trim()}>{crossVenueLoading ? 'Scanning venues…' : 'Compare venues'}</button>
        </form>
        {crossVenueError && <p className="quote-error">{crossVenueError}</p>}
        {crossVenueData && <>
          <div className="quote-consensus-stats">
            <div><span>VENUES RESPONDING</span><b>{crossVenueData.venueCount}</b></div>
            <div><span>MEDIAN LAST PRICE</span><b>{crossVenueData.medianLast == null ? '—' : Number(crossVenueData.medianLast).toLocaleString(undefined,{maximumFractionDigits:6})}</b></div>
            <div><span>LAST-PRICE DISPERSION</span><b>{crossVenueData.lastPriceSpreadPercent == null ? '—' : Number(crossVenueData.lastPriceSpreadPercent).toFixed(3) + '%'}</b></div>
            <div><span>TOP-OF-BOOK GROSS EDGE</span><b>{crossVenueData.bestIndicativeTopOfBook?.grossEdgePercent == null ? '—' : Number(crossVenueData.bestIndicativeTopOfBook.grossEdgePercent).toFixed(3) + '%'}</b></div>
          </div>
          <div className="quote-source-list">{(crossVenueData.venues || []).map((venue) => <div key={venue.exchange}><span>{venue.exchange.toUpperCase()}</span><b>{Number(venue.last).toLocaleString(undefined,{maximumFractionDigits:6})}</b><small>Bid {venue.bid ?? '—'} · Ask {venue.ask ?? '—'}{venue.outlier ? ' · OUTLIER REVIEW' : ''}</small></div>)}</div>
          <p className="subtle-note">{crossVenueData.bestIndicativeTopOfBook ? 'Indicative buy on ' + crossVenueData.bestIndicativeTopOfBook.buyVenue + ' / sell on ' + crossVenueData.bestIndicativeTopOfBook.sellVenue + '. This is not an executable arbitrage instruction.' : 'Insufficient comparable bid/ask data to calculate a cross-venue top-of-book edge.'}</p>
        </>}
      </section>
      <div className="section-heading ops-title"><div><span className="eyebrow">AUTOMATION & INFRASTRUCTURE</span><h3>Operational command grid</h3><p>Each service reports its actual state and unmet prerequisites.</p></div><button className="small-refresh" onClick={refresh}><RefreshCw size={13}/> Refresh</button></div>
      {renderOperations()}

      <div className="bottom-grid">
        <section className="glass-panel"><div className="panel-title"><div><span className="eyebrow">PROVIDER ECOSYSTEM</span><h3>Connected intelligence</h3></div><button onClick={() => activeNav('Financial & On-chain')}>View providers <ChevronRight size={13}/></button></div><div className="provider-chips">{(providers?.providers || []).slice(0, 12).map((provider) => <span key={provider.id} className={provider.configured ? 'configured' : ''}>{provider.name}</span>)}</div><p className="subtle-note">Credential presence is not the same as successful authentication or a live data entitlement.</p></section>
        <section className="glass-panel"><div className="panel-title"><div><span className="eyebrow">AUDIT STREAM</span><h3>Recent system events</h3></div><span className="live-tag">LOCAL LEDGER</span></div><div className="event-list">{events.slice(0, 5).map((event) => <div className="event-row" key={event.id}><i/><span><b>{event.kind === 'market-monitor-snapshot' ? 'Market monitor snapshot' : event.eventType || event.kind}</b><small>{event.source || event.markets?.length + ' market(s) sampled'} · {time(event.occurredAt)}</small></span></div>)}{!events.length && <p className="empty-state">No persisted events yet. Configure a watchlist or ingest verified transaction events.</p>}</div></section>
      </div>
    </>
  );

  const renderWorkspace = () => {
    if (page === 'Overview') return renderOverview();
    if (page === 'Financial & On-chain') return <FinancialIntelligence/>;
    if (page === 'Forecast & Strategy') return <section className="glass-panel detail-workspace">
      <span className="eyebrow">24-HOUR HIGH / LOW FORECAST ENGINE</span><h3>Statistical range intelligence</h3>
      <p>Forecasts are calculated from live exchange OHLCV using historical log-return volatility, ATR and bounded drift. They are estimates, not exchange-published values or calibrated probabilities.</p>
      <form className="news-search" onSubmit={loadForecast}>
        <select value={forecastExchange} onChange={(e) => setForecastExchange(e.target.value)}><option value="binance">Binance</option><option value="bitget">Bitget</option><option value="bybit">Bybit</option><option value="okx">OKX</option></select>
        <select value={forecastTimeframe} onChange={(e) => setForecastTimeframe(e.target.value)}><option value="15m">15m</option><option value="1h">1h</option><option value="4h">4h</option><option value="1d">1d</option></select>
        <button disabled={forecastLoading}>{forecastLoading ? 'Calculating…' : 'Calculate forecast for ' + symbol}</button>
      </form>
      {forecastError && <p className="quote-error">{forecastError}</p>}
      {forecastData && <><div className="quote-consensus-stats"><div><span>REFERENCE PRICE</span><b>{fmt(forecastData.referencePrice)}</b></div><div><span>ATR</span><b>{fmt(forecastData.atr)}</b></div><div><span>VOLATILITY / BAR</span><b>{Number(forecastData.volatilityPerCandlePercent).toFixed(3)}%</b></div><div><span>20-BAR MOMENTUM</span><b>{Number(forecastData.momentum20Percent).toFixed(2)}%</b></div></div>
      <div className="scanner-table"><div><span>HORIZON</span><span>FORECAST HIGH</span><span>EXPECTED MID</span><span>FORECAST LOW</span><span>RANGE METHOD</span></div>{forecastData.forecasts.map((f) => <div key={f.horizonHours}><b>{f.horizonHours}h</b><strong className="up">{fmt(f.forecastHigh)}</strong><strong>{fmt(f.expectedMid)}</strong><strong className="down">{fmt(f.forecastLow)}</strong><span>Volatility + ATR</span></div>)}</div>
      <p className="subtle-note">{forecastData.method}. {forecastData.limitations.join(' ')}</p></>}
      <div className="section-heading ops-title"><div><span className="eyebrow">LIVE MICROSTRUCTURE STREAM</span><h3>Order-book & derivatives telemetry</h3></div><span className="live-tag">{streamData ? 'STREAM CONNECTED' : 'CONNECTING'}</span></div>
       {streamData && <div className="quote-consensus-stats"><div><span>BOOK IMBALANCE</span><b>{streamData.orderBookAnalysis?.depthImbalance == null ? '—' : (streamData.orderBookAnalysis.depthImbalance * 100).toFixed(1) + '%'}</b></div><div><span>BID / ASK LEVELS</span><b>{(streamData.orderBook?.bids?.length ?? 0) + ' / ' + (streamData.orderBook?.asks?.length ?? 0)}</b></div><div><span>FUNDING RATE</span><b>{streamData.funding?.fundingRate == null ? '—' : Number(streamData.funding.fundingRate).toFixed(6)}</b></div><div><span>OPEN INTEREST</span><b>{fmt(streamData.openInterest?.openInterestAmount ?? streamData.openInterest?.openInterestValue)}</b></div></div>}
       <p className="subtle-note">{streamData ? 'Last sample: ' + new Date(streamData.sampledAt).toLocaleTimeString() + '. ' + streamData.transport : 'Waiting for exchange snapshots. Derivatives fields depend on venue and market support.'}</p>
       <div className="risk-list"><p><ShieldCheck/> Derivatives and order-book routes are separately available under /api/advanced.</p><p><ShieldCheck/> Confidence calibration and walk-forward validation remain required before deployment.</p><p><ShieldCheck/> No forecast submits or authorizes an order.</p></div>
    </section>;
    if (page === 'Walk-Forward Lab') return <section className="glass-panel detail-workspace">
       <span className="eyebrow">OUT-OF-SAMPLE STRATEGY RESEARCH</span><h3>Rolling walk-forward laboratory</h3>
       <p>Live exchange OHLCV is used to select EMA parameters on prior training windows and evaluate them on subsequent unseen test windows. This is a research baseline, not a profitability guarantee.</p>
       <form className="news-search" onSubmit={runWalkForward}>
         <select value={forecastExchange} onChange={e => setForecastExchange(e.target.value)}><option value="binance">Binance</option><option value="bitget">Bitget</option><option value="bybit">Bybit</option><option value="okx">OKX</option></select>
         <select value={forecastTimeframe} onChange={e => setForecastTimeframe(e.target.value)}><option value="15m">15m</option><option value="1h">1h</option><option value="4h">4h</option><option value="1d">1d</option></select>
         <input type="number" min="100" max="900" value={labTrainBars} onChange={e => setLabTrainBars(e.target.value)} aria-label="Training candles"/>
         <input type="number" min="20" max="300" value={labTestBars} onChange={e => setLabTestBars(e.target.value)} aria-label="Test candles"/>
         <button disabled={labLoading}>{labLoading ? 'Validating…' : 'Run walk-forward on ' + symbol}</button>
       </form>
       <p className="subtle-note">Training candles · test candles · 10 bps fee assumption · default EMA parameter grid. Requires enough history for at least one complete fold.</p>
       {labError && <p className="quote-error">{labError}</p>}
       {labData && <>
         <div className="quote-consensus-stats"><div><span>AGGREGATE OOS RETURN</span><b>{Number(labData.aggregateOutOfSample.totalReturnPercent).toFixed(2)}%</b></div><div><span>OOS MAX DRAWDOWN</span><b>{Number(labData.aggregateOutOfSample.maxDrawdownPercent).toFixed(2)}%</b></div><div><span>OOS OBSERVATIONS</span><b>{labData.aggregateOutOfSample.observations}</b></div><div><span>WALK-FORWARD FOLDS</span><b>{labData.folds.length}</b></div></div>
         <div className="scanner-table"><div><span>FOLD</span><span>SELECTED EMA</span><span>OOS RETURN</span><span>OOS DRAWDOWN</span><span>OOS BARS</span></div>{labData.folds.map(f => <div key={f.fold}><b>{f.fold}</b><strong className="up">{f.selectedParameters.fast}/{f.selectedParameters.slow}</strong><strong className={f.outOfSample.totalReturnPercent >= 0 ? 'up' : 'down'}>{Number(f.outOfSample.totalReturnPercent).toFixed(2)}%</strong><span>{Number(f.outOfSample.maxDrawdownPercent).toFixed(2)}%</span><span>{f.outOfSample.observations}</span></div>)}</div>
         <p className="subtle-note">{labData.caveats.join(' ')}</p>
       </>}
     </section>;
     if (page === 'Spot & Markets' || page === 'Futures') return <ExchangeConnectivity symbol={symbol} onSymbolChange={setSymbol}/>;
    if (page === 'Market Scanner') return <section className="glass-panel detail-workspace"><span className="eyebrow">LIVE MARKET MONITOR</span><h3>Monitored market universe</h3><p>JPTI samples real exchange tickers on the configured market-monitor interval. Add symbols to the server-side watchlist in your .env file.</p><pre>JPTI_MONITOR_MARKETS=binance:BTC/USDT,bitget:ETH/USDT</pre><div className="scanner-table"><div><span>EXCHANGE</span><span>SYMBOL</span><span>LAST</span><span>24H CHANGE</span><span>QUOTE VOLUME</span></div>{(marketJob?.lastSnapshot || []).map((item) => <div key={item.exchange + item.symbol}><b>{item.exchange}</b><b>{item.symbol}</b><strong>{fmt(item.last)}</strong><strong className={Number(item.percentage) >= 0 ? 'up' : 'down'}>{item.percentage == null ? '—' : fmt(item.percentage) + '%'}</strong><span>{fmt(item.quoteVolume)}</span></div>)}{!marketJob?.lastSnapshot?.length && <p className="empty-state">No live watchlist snapshot yet. Configure JPTI_MONITOR_MARKETS and wait for the next scheduler cycle.</p>}</div>{renderOperations()}</section>;
    if (page === 'Portfolio & Ledger') return <section className="glass-panel detail-workspace">
       <span className="eyebrow">PERSISTENT TRANSACTION JOURNAL</span><h3>Portfolio accounting & reconciliation</h3>
       <p>{ledger?.eventCount ?? 0} transaction events recorded. Configure read-only trade-history keys and the fill watchlist to keep the ledger current.</p>
       <div className="ledger-summary">{Object.entries(ledger?.byType || {}).map(([key, value]) => <div key={key}><span>{key}</span><b>{value}</b></div>)}</div>
       <form className="news-search" onSubmit={loadPortfolioAccounting}><input type="password" value={portfolioToken} onChange={e => setPortfolioToken(e.target.value)} placeholder="JPTI API token (kept in this page's memory only)"/><button disabled={portfolioLoading || !portfolioToken}>{portfolioLoading ? 'Loading accounts…' : 'Load private portfolio'}</button></form>
       {portfolioError && <p className="quote-error">{portfolioError}</p>}
       {portfolioData && <>
         <div className="quote-consensus-stats"><div><span>OPEN POSITIONS</span><b>{portfolioData.positions.length}</b></div><div><span>ASSET MOVEMENT LINES</span><b>{portfolioData.assetMovements.length}</b></div><div><span>EXCHANGE ACCOUNTS</span><b>{portfolioData.exchangeBalances.length}</b></div><div><span>REALIZED PNL CURRENCIES</span><b>{Object.keys(portfolioData.realizedPnlByQuoteCurrency).length}</b></div></div>
         <h4>Open positions · weighted-average cost</h4>
         <div className="scanner-table"><div><span>EXCHANGE / MARKET</span><span>QUANTITY</span><span>AVG COST</span><span>MARK</span><span>UNREALIZED PNL</span></div>{portfolioData.positions.map(p => <div key={p.exchange + p.accountId + p.symbol}><b>{p.exchange} · {p.symbol}</b><span>{fmt(p.quantity)}</span><span>{fmt(p.averageCost)}</span><span>{fmt(p.marketPrice)}</span><strong className={Number(p.unrealizedPnl) >= 0 ? 'up' : 'down'}>{fmt(p.unrealizedPnl)}</strong></div>)}{!portfolioData.positions.length && <p className="empty-state">No fill-based positions have been ingested yet.</p>}</div>
         <h4>Current exchange balances</h4><div className="scanner-table"><div><span>EXCHANGE</span><span>CURRENCY</span><span>FREE</span><span>USED</span><span>TOTAL</span></div>{portfolioData.exchangeBalances.flatMap(b => b.status === 'ok' ? Object.entries(b.total || {}).filter(([, amount]) => Number(amount) > 0).map(([currency, amount]) => <div key={b.exchange + currency}><b>{b.exchange}</b><span>{currency}</span><span>{fmt(b.free?.[currency])}</span><span>{fmt(b.used?.[currency])}</span><strong>{fmt(amount)}</strong></div>) : [<div key={b.exchange}><b>{b.exchange}</b><span>{b.status}</span><span>{b.error || 'Balance capability unavailable'}</span></div>])}</div>
         <h4>Realized PnL by quote currency</h4><div className="ledger-summary">{Object.entries(portfolioData.realizedPnlByQuoteCurrency).map(([currency, amount]) => <div key={currency}><span>{currency}</span><b>{fmt(amount)}</b></div>)}</div>
         <p className="subtle-note">{portfolioData.reconciliationNote} {portfolioData.limitations.join(' ')}</p>
       </>}
       <p className="subtle-note">Private API token is held only in component memory and is not saved to local storage. Scheduled fill ingestion: JPTI_FILL_SYNC_MARKETS=binance:BTC/USDT,bitget:ETH/USDT. Read-only keys only; withdrawals remain disabled.</p>
       {renderOperations()}
     </section>;
    if (page === 'News & Events') return <section className="glass-panel detail-workspace"><span className="eyebrow">GLOBAL NEWS DISCOVERY</span><h3>Market news radar</h3><p>Searches the GDELT global news index. Verify publication time, original reporting and source credibility before using any article as trading evidence.</p><form className="news-search" onSubmit={loadNews}><input value={newsQuery} onChange={(event) => setNewsQuery(event.target.value)} placeholder="Search market, ticker, central bank, event..."/><button disabled={newsLoading}>{newsLoading ? 'Searching...' : 'Search news'}</button></form>{newsError && <p className="subtle-note">{newsError}</p>}<div className="news-results">{newsData.map((article, index) => <a href={article.url} target="_blank" rel="noreferrer" key={article.url || index}><span>{article.domain || article.sourcecountry || 'NEWS SOURCE'} · {article.seendate || 'Timestamp unavailable'}</span><b>{article.title || 'Untitled article'}</b><small>{article.sourcecountry || 'Global'} · Open original source ↗</small></a>)}{!newsData.length && !newsLoading && <p className="empty-state">Search to load current news results.</p>}</div></section>;
    if (page === 'Risk Management') return <section className="glass-panel detail-workspace"><span className="eyebrow">CAPITAL PROTECTION</span><h3>Execution guardrails</h3><div className="risk-list"><p><ShieldCheck/> Live trading disabled by default.</p><p><ShieldCheck/> API-token and explicit live confirmation required.</p><p><ShieldCheck/> USDT spot-only initial live-order policy.</p><p><ShieldCheck/> Per-order notional cap enforced server-side.</p><p><ShieldCheck/> No withdrawal capability exposed.</p></div>{renderOperations()}</section>;
    if (page === 'Trading Bots' || page === 'AI Intelligence') return <section className="glass-panel detail-workspace"><span className="eyebrow">AGENT ORCHESTRATION</span><h3>{page === 'AI Intelligence' ? 'Explainable intelligence services' : 'Trading automation control'}</h3><p>Agent execution is not represented as active until its worker, strategy, data sources and risk policy are implemented and verified. Current service readiness is shown below.</p>{renderOperations()}</section>;
    return <section className="glass-panel detail-workspace"><span className="eyebrow">RESEARCH WORKSPACE</span><h3>{page}</h3><p>This workspace is reserved for verified data and tested functionality. It will not display fabricated performance, positions or economic events.</p>{renderOperations()}</section>;
  };

  const groups = [...new Set(navigation.map((item) => item.group))];
  return <div className="jpti-shell">
    <div className="ambient ambient-a"/><div className="ambient ambient-b"/>
    <aside className={'command-sidebar ' + (mobileOpen ? 'mobile-open' : '')}>
      <div className="brand-lockup"><div className="brand-mark"><span>J</span><i/></div><div><b>JOPEARL</b><small>TRADING INTELLIGENCE</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)}><X size={17}/></button></div>
      <div className="workspace-pill"><span className="workspace-avatar">JP</span><span><b>JPTI COMMAND</b><small>Personal workspace</small></span><ChevronRight size={14}/></div>
      <label className="side-label">NAVIGATION</label>
      <div className="side-search"><Search size={14}/><input placeholder="Find a workspace" value={query} onChange={(e) => setQuery(e.target.value)}/><Command size={12}/></div>
      <nav>{groups.map((group) => <div className="nav-group" key={group}><small>{group}</small>{filteredNav.filter((item) => item.group === group).map((item) => { const Icon = item.icon; return <button key={item.label} className={page === item.label ? 'active' : ''} onClick={() => activeNav(item.label)}><Icon size={16}/><span>{item.label}</span>{item.label === 'Financial & On-chain' && <i>DATA</i>}</button>; })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-status"><span className="pulse-dot"/><span><b>{gatewayOnline ? 'SYSTEM OPERATIONAL' : 'CONNECTING TO API'}</b><small>{health?.mode || 'Awaiting gateway'}</small></span></div><div className="sidebar-footer"><span><Settings2 size={14}/> Settings</span><span><CircleHelp size={14}/> Help</span></div><small className="build-label">JPTI · SECURE TRADING INFRASTRUCTURE</small></div>
    </aside>

    <main className="command-main">
      <header className="command-topbar"><div className="top-left"><button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={18}/></button><div className="breadcrumb">JOPEARL <ChevronRight size={12}/> <b>{page.toUpperCase()}</b></div></div><div className="top-right"><span className="market-state"><i/> {gatewayOnline ? 'API CONNECTED' : 'API DISCONNECTED'}</span><span className="top-divider"/><button className="icon-action" onClick={refresh} title="Refresh system"><RefreshCw size={15}/></button><button className="icon-action" title="Notifications"><Bell size={15}/></button><div className="user-chip"><span>JP</span><b>Operator</b></div></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="heading-eyebrow"><Sparkles size={13}/> INTELLIGENCE, PRECISION, CONTROL</div><h1>{page === 'Overview' ? 'Trading command center' : page}</h1><p>{pageDescription[page] || 'JPTI intelligence workspace.'}</p></div><div className="heading-tools"><span className="paper-chip"><ShieldCheck size={13}/> PAPER-FIRST</span><button className="refresh-button" onClick={refresh}><RefreshCw size={14}/> Sync</button></div></div>
        {loadError && <div className="connection-warning"><Zap size={15}/>{loadError} — start the JPTI API service to load live system data.</div>}
        {renderWorkspace()}
        <footer className="command-footer"><span>© 2026 JOPEARL TRADING INTELLIGENCE</span><span>MARKET DATA IS NOT A TRADE RECOMMENDATION</span><span>LIVE EXECUTION LOCKED BY DEFAULT</span></footer>
      </div>
    </main>
  </div>;
}

export default App;
