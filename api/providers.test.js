import test from 'node:test';
import assert from 'node:assert/strict';
import { getOperationalIntervals, providerDirectory } from './providers.js';

test('provider registry includes requested market, news and blockchain vendors', () => {
  const ids = providerDirectory().map((item) => item.id);
  for (const id of ['alpaca','quiver','finnhub','alphavantage','twelvedata','infura','liquid','gdelt']) assert.ok(ids.includes(id), id);
});

test('operational intervals expose positive second-based defaults', () => {
  const values = getOperationalIntervals();
  assert.equal(values.marketMonitorSeconds, 5);
  assert.equal(values.reconcileSeconds, 30);
  assert.equal(values.investorMonitorSeconds, 60);
  for (const [key, value] of Object.entries(values)) if (key !== 'schedulerEnabled') assert.ok(Number.isInteger(value) && value > 0, key);
});

test('provider directory exposes credential presence without leaking secret values', () => {
  const previousKey = process.env.JPTI_ALPACA_API_KEY;
  const previousSecret = process.env.JPTI_ALPACA_API_SECRET;
  process.env.JPTI_ALPACA_API_KEY = 'test-key-must-not-leak';
  process.env.JPTI_ALPACA_API_SECRET = 'test-secret-must-not-leak';
  try {
    const alpaca = providerDirectory().find((item) => item.id === 'alpaca');
    assert.equal(alpaca.configured, true);
    assert.deepEqual(alpaca.missingCredentials, []);
    assert.equal(JSON.stringify(alpaca).includes('test-key-must-not-leak'), false);
    assert.equal(JSON.stringify(alpaca).includes('test-secret-must-not-leak'), false);
  } finally {
    if (previousKey === undefined) delete process.env.JPTI_ALPACA_API_KEY; else process.env.JPTI_ALPACA_API_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.JPTI_ALPACA_API_SECRET; else process.env.JPTI_ALPACA_API_SECRET = previousSecret;
  }
});
