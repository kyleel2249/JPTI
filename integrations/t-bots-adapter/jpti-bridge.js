// JPTI bridge: paper-only T-Bots publishes auditable agent events and consumes JPTI's coarse market-regime context.
export class JptiBridge {
  constructor() { this.token = ''; this.lastContextAt = 0; this.context = null; this.lastMemory = null; this.risk = null; this.lastRiskAt = 0; this.assetEvidence = new Map(); this.lastAssetEvidenceAt = 0; this.cexMarkets = null; this.lastCexMarketsAt = 0; this.macro = null; this.lastMacroAt = 0; this.dexWatchlist = null; this.lastDexWatchlistAt = 0; }
  setToken(value) { this.token = String(value || '').trim(); }
  get enabled() { return Boolean(this.token); }
  async _request(path, options = {}) {
    if (!this.enabled) return null;
    const url = path.startsWith('/') ? '/api' + path : '/api/integrations/tbots/' + path;
    const response = await fetch(url, {
      ...options, headers: { 'content-type': 'application/json', 'x-jpti-api-token': this.token, ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'JPTI bridge request failed (' + response.status + ')');
    return body;
  }
  async refreshContext(force = false) {
    if (!this.enabled || Date.now() - this.lastContextAt < 60000 && !force) return this.context;
    this.lastContextAt = Date.now();
    try { this.context = await this._request('/universal/market/binance/BTC%2FUSDT%3AUSDT?timeframe=1h'); }
    catch (error) {
      try { this.context = await this._request('context?exchange=binance&symbol=BTC%2FUSDT'); }
      catch (fallbackError) { this.context = null; this.lastError = fallbackError.message || error.message; }
    }
    return this.context;
  }
  async refreshMacro(force = false) {
    if (!this.enabled || Date.now() - this.lastMacroAt < 300000 && !force) return this.macro;
    this.lastMacroAt = Date.now();
    try { this.macro = await this._request('/universal/macro'); }
    catch (error) { this.macro = null; this.lastError = error.message; }
    return this.macro;
  }
  async refreshRisk(force = false) {
    if (!this.enabled || Date.now() - this.lastRiskAt < 30000 && !force) return this.risk;
    this.lastRiskAt = Date.now();
    try { this.risk = await this._request('/universal/risk'); }
    catch (error) { this.risk = { newEntriesAllowed: false, pauseReasons: ['JPTI shared risk state unavailable'], error: error.message, exitsRemainEnabled: true }; this.lastError = error.message; }
    return this.risk;
  }
  async refreshDexWatchlist(force = false) {
    if (!this.enabled || Date.now() - this.lastDexWatchlistAt < 15000 && !force) return this.dexWatchlist;
    this.lastDexWatchlistAt = Date.now();
    try { this.dexWatchlist = await this._request('/universal/dex-watchlist'); }
    catch (error) { this.dexWatchlist = { pairs:[], status:'unavailable', error:error.message }; this.lastError = error.message; }
    return this.dexWatchlist;
  }
  async refreshCexMarkets(force = false) {
    if (!this.enabled || Date.now() - this.lastCexMarketsAt < 12000 && !force) return this.cexMarkets;
    this.lastCexMarketsAt = Date.now();
    try { this.cexMarkets = await this._request('/universal/cex-watchlist'); }
    catch (error) { this.cexMarkets = { markets: [], status:'unavailable', error:error.message }; this.lastError = error.message; }
    return this.cexMarkets;
  }
  async refreshAssetEvidence(tokens = [], force = false) {
    if (!this.enabled || Date.now() - this.lastAssetEvidenceAt < 30000 && !force) return this.assetEvidence;
    const assets = tokens.filter(t => t?.tokenAddress && t?.chain).slice(0, 80).map(t => ({
      id:t.id, chain:t.chain, address:t.tokenAddress, symbol:t.symbol,
      liquidityUsd:t.liquidityUsd, volume24hUsd:t.volume24hUsd, volume1hUsd:t.volume1hUsd,
      change1hPct:t.change1hPct, ageMin:t.ageMin, buys:t.buys1h, sells:t.sells1h,
      quoteAddress:t.quoteAddress, quoteSymbol:t.quoteSymbol
    }));
    if (!assets.length) return this.assetEvidence;
    this.lastAssetEvidenceAt = Date.now();
    try {
      const result = await this._request('/universal/asset-evidence', { method:'POST', body:JSON.stringify({assets}) });
      this.assetEvidence = new Map((result.evidence || []).map(item => [item.id, item]));
      this.lastAssetEvidenceError = null;
    } catch (error) { this.lastAssetEvidenceError = error.message; }
    return this.assetEvidence;
  }
  async searchUniverse(query) {
    if (!this.enabled || String(query || '').trim().length < 2) return null;
    return this._request('universe?q=' + encodeURIComponent(String(query).trim()));
  }
  async loadMemory() {
    if (!this.enabled) return null;
    try { this.lastMemory = await this._request('memory?limit=50'); return this.lastMemory; }
    catch (error) { this.lastError = error.message; return null; }
  }
  publish(eventType, runId, symbol, metadata = {}, quantity = 0) {
    if (!this.enabled) return;
    const externalId = 'tbots:' + runId + ':' + eventType + ':' + (metadata.sequence || metadata.at || Date.now()) + ':' + Math.random().toString(36).slice(2, 8);
    this._request('events', { method: 'POST', body: JSON.stringify({ eventType, externalId, runId, symbol, quantity, occurredAt: new Date().toISOString(), metadata }) })
      .catch(error => { this.lastError = error.message; });
  }
  attach(orchestrator, runId) {
    if (!this.enabled) return;
    const bus = orchestrator.bus;
    const tags = event => {
      const token = event.tokenId ? orchestrator.feed.get(event.tokenId) : null;
      return { strategyProfile: orchestrator.cfg.scanner.assetProfile || 'meme_new_pair',
        assetClass: token?.assetClass || (token?.marketType === 'cex' ? 'crypto_spot' : 'dex_token'),
        chain: token?.chain || null, venue: token?.exchange || token?.dex || null, runId };
    };
    bus.on('trade:enter', event => this.publish('bot_trade', runId, event.symbol, { ...tags(event), action: 'paper_enter', reason: event.reason, sizePct: event.sizePct, price: event.price }));
    bus.on('trade:exit', event => this.publish('bot_trade', runId, event.symbol, { ...tags(event), action: 'paper_exit', reason: event.reason, pnl: event.pnl, price: event.price, partial: event.partial }));
    bus.on('trade:closed', event => this.publish('bot_trade', runId, event.symbol, { ...tags(event), action: 'paper_closed', pnl: event.pnl, cost: event.cost, proceeds: event.proceeds, reason: event.reason }));
    bus.on('trade:filtered', event => this.publish('bot_filter', runId, event.symbol, { ...tags(event), reason: event.reason }));
    bus.on('sys', event => this.publish('bot_decision', runId, 'SYSTEM', { reason: event.reason }));
    bus.on('session:end', recap => this.publish('bot_session', runId, 'SESSION', { action: 'paper_session_closed', strategyProfile: orchestrator.cfg.scanner.assetProfile || 'meme_new_pair', trades: recap.trades, wins: recap.wins, losses: recap.losses, returnPct: recap.returnPct, start: recap.start, end: recap.end }));
  }
}
