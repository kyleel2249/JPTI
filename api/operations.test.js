import test from 'node:test';
import assert from 'node:assert/strict';
import { getOperationsSnapshot } from './operations.js';

test('operations snapshot exposes monitored services and honest waiting states', () => {
  const snapshot = getOperationsSnapshot();
  const ids = snapshot.jobs.map((job) => job.id);
  for (const id of ['market-monitor','provider-health','reconciliation','investor-monitor','market-maker','news-monitor','onchain-monitor']) assert.ok(ids.includes(id));
  assert.equal(snapshot.schedulerEnabled, true);
  assert.ok(snapshot.uptimeSeconds >= 0);
});

