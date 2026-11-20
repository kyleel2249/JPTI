// JPTI bridge: paper-only T-Bots publishes auditable agent events and consumes JPTI's coarse market-regime context.
export class JptiBridge {
  constructor() { this.token = ''; this.lastContextAt = 0; this.context = null; this.lastMemory = null; }
  setToken(value) { this.token = String(value || '').trim(); }
  get enabled() { return Boolean(this.token); }
  async _request(path, options = {}) {
    if (!this.enabled) return null;
    const response = await fetch('/api/integrations/tbots/' + path, {
      ...options, headers: { 'content-type': 'application/json', 'x-jpti-api-token': this.token, ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'JPTI bridge request failed (' + response.status + ')');
    return body;
  }
  async refreshContext(force = false) {
    if (!this.enabled || Date.now() - this.lastContextAt < 60000 && !force) return this.context;
    this.lastContextAt = Date.now();
    try { this.context = await this._request('context?exchange=binance&symbol=BTC%2FUSDT'); }
    catch (error) { this.context = null; this.lastError = error.message; }
    return this.context;
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
    bus.on('trade:enter', event => this.publish('bot_trade', runId, event.symbol, { action: 'paper_enter', reason: event.reason, sizePct: event.sizePct, price: event.price }));
    bus.on('trade:exit', event => this.publish('bot_trade', runId, event.symbol, { action: 'paper_exit', reason: event.reason, pnl: event.pnl, price: event.price, partial: event.partial }));
    bus.on('trade:closed', event => this.publish('bot_trade', runId, event.symbol, { action: 'paper_closed', pnl: event.pnl, cost: event.cost, proceeds: event.proceeds, reason: event.reason }));
    bus.on('trade:filtered', event => this.publish('bot_filter', runId, event.symbol, { reason: event.reason }));
    bus.on('sys', event => this.publish('bot_decision', runId, 'SYSTEM', { reason: event.reason }));
  }
}
