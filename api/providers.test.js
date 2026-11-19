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
