import React, { useEffect, useState } from 'react';
import { apiFetch, getApiBaseUrl, setApiBaseUrl, validateApiBaseUrl } from './lib/api.js';

export default function ConnectionSettings() {
  const [url, setUrl] = useState(getApiBaseUrl());
  const [saved, setSaved] = useState(getApiBaseUrl());
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setUrl(getApiBaseUrl()); setSaved(getApiBaseUrl()); }, []);

  const save = () => {
    const result = validateApiBaseUrl(url);
    if (!result.valid) { setError(result.error); return; }
    try {
      const next = setApiBaseUrl(result.value);
      setSaved(next); setUrl(next); setError(''); setStatus(null);
    } catch (e) { setError(e.message); }
  };

  const test = async () => {
    const result = validateApiBaseUrl(url);
    if (!result.valid) { setError(result.error); return; }
    setBusy(true); setError(''); setStatus(null);
    try {
      const response = await fetch((result.value || '') + '/api/health', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'JPTI API health check failed.');
      setStatus({ ok: true, data });
    } catch (e) {
      setStatus({ ok: false });
      setError(e.message + ' Check that the API is running, the URL is correct, and remote access/CORS are configured.');
    } finally { setBusy(false); }
  };

  const useLocal = () => { setUrl(''); setApiBaseUrl(''); setSaved(''); setStatus(null); setError(''); };
  const isDirty = url.trim().replace(/\/$/, '') !== saved;

  return <section className="glass-panel detail-workspace connection-settings">
    <span className="eyebrow">DEVICE & API CONFIGURATION</span>
    <h3>Choose where this JPTI app connects</h3>
    <p>JPTI can run against its local desktop API or connect to a secured remote API through your Cloudflare Pages address. This setting changes the API destination only; it does not upload your local ledger or exchange credentials.</p>
    <div className="quote-consensus-stats">
      <div><span>ACTIVE CONNECTION</span><b>{saved ? 'REMOTE / CLOUD' : 'LOCAL / SAME ORIGIN'}</b></div>
      <div><span>API BASE</span><b>{saved || 'Current device origin'}</b></div>
      <div><span>PRIVATE TOKEN</span><b>Not stored here</b></div>
      <div><span>TRADING MODE</span><b>Paper-first</b></div>
    </div>
    <div className="detail-workspace">
      <label className="connection-label">Cloud or remote JPTI URL</label>
      <input className="connection-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-jpti.pages.dev"/>
      <p className="subtle-note">Leave blank to use the same origin. On Windows desktop this is the local JPTI service. On Android, use your secured Cloudflare Pages URL or another HTTPS endpoint.</p>
      {error && <p className="quote-error">{error}</p>}
      {status?.ok && <p className="connection-success">Connected · {status.data.service} · {status.data.mode} mode · {status.data.liveTradingEnabled ? 'Live execution enabled' : 'Live execution disabled'}</p>}
      <div className="news-search">
        <button type="button" onClick={test} disabled={busy}>{busy ? 'Testing connection…' : 'Test connection'}</button>
        <button type="button" onClick={save} disabled={!isDirty}>Save connection</button>
        <button type="button" onClick={useLocal}>Use local / same origin</button>
      </div>
    </div>
    <div className="detail-workspace">
      <h4>How to connect your devices</h4>
      <div className="risk-list">
        <p>Windows desktop: install and open the JPTI desktop app. It starts the local API and uses local durable storage by default.</p>
        <p>Android: install the Android app, enter your Cloudflare Pages HTTPS URL here, and test the connection. The Pages Function securely forwards API requests to your hosted Node service.</p>
        <p>Shared local network: a phone cannot use 127.0.0.1 to reach your PC. Use the PC's LAN address only behind a properly secured HTTPS reverse proxy or VPN.</p>
        <p>Private API tokens are entered only in the protected JPTI workflows. This connection setting stores only the API base URL, never exchange keys or API tokens.</p>
      </div>
    </div>
  </section>;
}
