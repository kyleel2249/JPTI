import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendStoredEvent, appendUniqueLedgerEvent, getStorageStatus, getSyncCursor, initializeStorage, readStoredEvents, setSyncCursor } from './storage.js';

test('file storage initializes and reports its selected backend', async () => {
  const status = await initializeStorage();
  assert.equal(status.backend, 'file');
  assert.equal(status.initialized, true);
  assert.equal(status.durable, false);
});

test('ledger events are idempotent across repeated ingestion', async () => {
  await initializeStorage();
  const id = randomUUID();
  const event = { id:randomUUID(), kind:'ledger-transaction', source:'storage-test', accountId:'test-account', externalId:id,
    eventType:'fill', symbol:'BTC/USDT', occurredAt:new Date().toISOString(), quantity:1, price:100 };
  const first = await appendUniqueLedgerEvent(event);
  const second = await appendUniqueLedgerEvent({ ...event, id:randomUUID() });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.event.id, first.event.id);
});

test('sync cursors survive module-level scheduler state and never move backwards', async () => {
  await initializeStorage();
  const key = 'storage-test:' + randomUUID();
  assert.equal(await getSyncCursor(key, 123), 123);
  await setSyncCursor(key, 456);
  await setSyncCursor(key, 400);
  assert.equal(await getSyncCursor(key), 456);
});

test('operational events can be read back from the selected storage adapter', async () => {
  await initializeStorage();
  const marker = randomUUID();
  await appendStoredEvent({ id:randomUUID(), kind:'storage-test-event', marker, occurredAt:new Date().toISOString() });
  const events = await readStoredEvents(100, 'storage-test-event');
  assert.ok(events.some(event => event.marker === marker));
  assert.equal(getStorageStatus().initialized, true);
});
