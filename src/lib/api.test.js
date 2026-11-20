import test from 'node:test';
import assert from 'node:assert/strict';
import { apiUrl, getApiBaseUrl, setApiBaseUrl, validateApiBaseUrl } from './api.js';

test('accepts blank same-origin and loopback desktop API addresses', () => {
  assert.deepEqual(validateApiBaseUrl(''), { valid: true, value: '' });
  assert.equal(validateApiBaseUrl('http://127.0.0.1:8787').valid, true);
  assert.equal(validateApiBaseUrl('http://localhost:8787').valid, true);
});

test('requires HTTPS for remote API origins', () => {
  assert.equal(validateApiBaseUrl('https://jpti.example.com').valid, true);
  assert.equal(validateApiBaseUrl('http://192.168.1.20:8787').valid, false);
});

test('rejects URL credentials, paths, query strings and fragments', () => {
  for (const value of [
    'https://user:pass@jpti.example.com',
    'https://jpti.example.com/api',
    'https://jpti.example.com?token=x',
    'https://jpti.example.com#section'
  ]) assert.equal(validateApiBaseUrl(value).valid, false);
});

test('stores only normalized API origin and builds same-origin request URLs', () => {
  const previous = globalThis.window;
  const store = new Map();
  globalThis.window = { localStorage: {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
  } };
  try {
    assert.equal(setApiBaseUrl('https://jpti.example.com/'), 'https://jpti.example.com');
    assert.equal(getApiBaseUrl(), 'https://jpti.example.com');
    assert.equal(apiUrl('/api/health'), 'https://jpti.example.com/api/health');
    setApiBaseUrl('');
    assert.equal(apiUrl('/api/health'), '/api/health');
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
