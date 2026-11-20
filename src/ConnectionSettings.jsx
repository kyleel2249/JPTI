import React, { useEffect, useState } from 'react';
import { getApiBaseUrl, setApiBaseUrl, validateApiBaseUrl } from './lib/api.js';

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
      setError(e.message + ' Check that the PC API is running, the URL is correct, and local-network access/CORS are configured.');
    } finally { setBusy(false); }
  };

  const useLocal = () => { setUrl(''); setApiBaseUrl(''); setSaved(''); setStatus(null); setError(''); };
  const isDirty = url.trim().replace(/\/$/, '') !== saved;

  return <section className="glass-panel detail-workspace connection-settings">
    <span className="eyebrow">DEVICE & API CONFIGURATION</span>
    <h3>Choose where this JPTI app connects</h3>
    <p>JPTI runs on your own PC. The Windows desktop app uses its local API automatically; the Android app connects to that same API over your trusted local network. This setting changes only the API address and never uploads your ledger or exchange credentials.</p>
    <div className="quote-consensus-stats">
      <div><span>ACTIVE CONNECTION</span><b>{saved ? 'LOCAL NETWORK API' : 'SAME-ORIGIN LOCAL API'}</b></div>
      <div><span>API BASE</span><b>{saved || 'Current app origin'}</b></div>
      <div><span>PRIVATE TOKEN</span><b>Not stored here</b></div>
      <div><span>TRADING MODE</span><b>Paper-first</b></div>
    </div>
    <div className="detail-workspace">
      <label className="connection-label">Local PC JPTI API URL</label>
      <input className="connection-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://192.168.1.10:8787"/>
      <p className="subtle-note">Leave blank to use the local API. On Android, enter the PC's LAN address using a trusted HTTPS certificate or a private VPN endpoint.</p>
      {error && <p className="quote-error">{error}</p>}
      {status?.ok && <p className="connection-success">Connected · {status.data.service} · {status.data.mode} mode · {status.data.liveTradingEnabled ? 'Live execution enabled' : 'Live execution disabled'}</p>}
      <div className="news-search">
        <button type="button" onClick={test} disabled={busy}>{busy ? 'Testing connection…' : 'Test connection'}</button>
        <button type="button" onClick={save} disabled={!isDirty}>Save connection</button>
        <button type="button" onClick={useLocal}>Use same-origin default</button>
      </div>
    </div>
    <div className="detail-workspace">
      <h4>How to connect your devices</h4>
      <div className="risk-list">
        <p>Windows desktop: install and open JPTI. It starts its API on the same PC and stores its ledger locally.</p>
        <p>Android: install the Android app and enter the PC's local-network HTTPS API address. Both devices must be on the same trusted Wi-Fi network or private VPN.</p>
        <p>Local network: a phone cannot use 127.0.0.1 to reach your PC. Configure the PC API to listen on its LAN interface and protect it with a trusted HTTPS endpoint or private VPN plus a strong API token.</p>
        <p>Private API tokens are entered only in the protected JPTI workflows. This connection setting stores only the API base URL, never exchange keys or API tokens.</p>
      </div>
    </div>
  </section>;
}
