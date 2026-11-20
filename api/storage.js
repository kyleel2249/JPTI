import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = resolve(process.env.JPTI_DATA_DIR || 'data');
const eventsFile = resolve(dataDir, 'jpti-events.jsonl');
const cursorsFile = resolve(dataDir, 'jpti-cursors.json');
const backend = String(process.env.JPTI_STORAGE_BACKEND || (process.env.DATABASE_URL ? 'postgres' : 'file')).toLowerCase();
let pool;
let initialized = false;
let fileWriteQueue = Promise.resolve();
let cursorWriteQueue = Promise.resolve();

const migration = `
CREATE TABLE IF NOT EXISTS jpti_events (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  source TEXT,
  account_id TEXT,
  external_id TEXT,
  symbol TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS jpti_ledger_event_dedupe
  ON jpti_events (source, account_id, external_id, COALESCE(symbol, ''))
  WHERE kind = 'ledger-transaction';
CREATE INDEX IF NOT EXISTS jpti_events_kind_time
  ON jpti_events (kind, occurred_at DESC, created_at DESC);
CREATE TABLE IF NOT EXISTS jpti_sync_cursors (
  cursor_key TEXT PRIMARY KEY,
  cursor_value BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS jpti_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function getPool() {
  if (pool) return pool;
  const pg = await import('pg');
  const ssl = process.env.JPTI_DATABASE_SSL === 'true'
    ? { rejectUnauthorized: process.env.JPTI_DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false;
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    max: Math.max(1, Math.min(20, Number(process.env.JPTI_DATABASE_POOL_MAX) || 10)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: 'jpti-trading-intelligence'
  });
  pool.on('error', (error) => {
    console.error('JPTI PostgreSQL pool error:', error.message);
  });
  return pool;
}

export async function initializeStorage() {
  if (initialized) return getStorageStatus();
  if (!['file', 'postgres'].includes(backend)) throw new Error('JPTI_STORAGE_BACKEND must be file or postgres.');
  if (backend === 'postgres') {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when JPTI_STORAGE_BACKEND=postgres.');
    const db = await getPool();
    await db.query(migration);
    await db.query("INSERT INTO jpti_schema_migrations(version) VALUES ('001_initial_durable_storage') ON CONFLICT DO NOTHING");
  } else {
    await mkdir(dataDir, { recursive: true });
  }
  initialized = true;
  return getStorageStatus();
}

function assertInitialized() {
  if (!initialized) throw new Error('JPTI storage has not been initialized.');
}

async function readFileEvents(limit) {
  try {
    const raw = await readFile(eventsFile, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const selected = Number.isFinite(limit) ? lines.slice(-Math.max(1, limit)) : lines;
    return selected.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readStoredEvents(limit = 20000, kind = null) {
  assertInitialized();
  if (backend === 'file') {
    const events = await readFileEvents(limit);
    const filtered = kind ? events.filter(event => event.kind === kind) : events;
    return Number.isFinite(limit) ? filtered.slice(-limit) : filtered;
  }
  const db = await getPool();
  const values = kind ? [kind, Number.isFinite(limit) ? Math.max(1, limit) : 1000000] : [Number.isFinite(limit) ? Math.max(1, limit) : 1000000];
  const where = kind ? 'WHERE kind = $1' : '';
  const limitParam = kind ? '$2' : '$1';
  const result = await db.query(`SELECT payload FROM jpti_events ${where} ORDER BY created_at DESC LIMIT ${limitParam}`, values);
  return result.rows.reverse().map(row => row.payload);
}

async function appendFileEvent(event) {
  fileWriteQueue = fileWriteQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(eventsFile), { recursive: true });
    await appendFile(eventsFile, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 });
  });
  await fileWriteQueue;
  return event;
}

export async function appendStoredEvent(input) {
  assertInitialized();
  const event = { id: input.id || randomUUID(), ...input };
  if (backend === 'file') return appendFileEvent(event);
  const db = await getPool();
  await db.query(
    'INSERT INTO jpti_events(id,kind,source,account_id,external_id,symbol,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [event.id, event.kind || 'operational-event', event.source || null, event.accountId || null, event.externalId || null, event.symbol || null,
      event.occurredAt || event.ingestedAt || new Date().toISOString(), JSON.stringify(event)]
  );
  return event;
}

export async function appendUniqueLedgerEvent(input) {
  assertInitialized();
  const event = { id: input.id || randomUUID(), kind: 'ledger-transaction', ...input };
  if (backend === 'file') {
    let result;
    fileWriteQueue = fileWriteQueue.catch(() => {}).then(async () => {
      const events = await readFileEvents(Infinity);
      const duplicate = events.find(item => item.kind === 'ledger-transaction' && item.source === event.source &&
        item.accountId === event.accountId && item.externalId === event.externalId && item.symbol === event.symbol);
      if (duplicate) { result = { duplicate: true, event: duplicate }; return; }
      await mkdir(dirname(eventsFile), { recursive: true });
      await appendFile(eventsFile, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 });
      result = { duplicate: false, event };
    });
    await fileWriteQueue;
    return result;
  }
  const db = await getPool();
  const result = await db.query(
    "INSERT INTO jpti_events(id,kind,source,account_id,external_id,symbol,occurred_at,payload) VALUES($1,'ledger-transaction',$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (source,account_id,external_id,(COALESCE(symbol,''))) WHERE kind='ledger-transaction' DO NOTHING RETURNING payload",
    [event.id, event.source, event.accountId, event.externalId, event.symbol || null, event.occurredAt || event.ingestedAt || new Date().toISOString(), JSON.stringify(event)]
  );
  if (result.rowCount) return { duplicate: false, event: result.rows[0].payload };
  const duplicate = await db.query(
    "SELECT payload FROM jpti_events WHERE kind='ledger-transaction' AND source=$1 AND account_id=$2 AND external_id=$3 AND COALESCE(symbol,'')=COALESCE($4,'') LIMIT 1",
    [event.source, event.accountId, event.externalId, event.symbol || null]
  );
  return { duplicate: true, event: duplicate.rows[0]?.payload || null };
}

export async function getSyncCursor(key, fallback = null) {
  assertInitialized();
  if (backend === 'postgres') {
    const result = await (await getPool()).query('SELECT cursor_value FROM jpti_sync_cursors WHERE cursor_key=$1', [key]);
    return result.rows.length ? Number(result.rows[0].cursor_value) : fallback;
  }
  try {
    const parsed = JSON.parse(await readFile(cursorsFile, 'utf8'));
    return Number.isFinite(Number(parsed[key])) ? Number(parsed[key]) : fallback;
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function setSyncCursor(key, value) {
  assertInitialized();
  const cursor = Math.max(0, Math.floor(Number(value)));
  if (!Number.isFinite(cursor)) throw new Error('Sync cursor must be a finite non-negative number.');
  if (backend === 'postgres') {
    await (await getPool()).query(
      'INSERT INTO jpti_sync_cursors(cursor_key,cursor_value) VALUES($1,$2) ON CONFLICT(cursor_key) DO UPDATE SET cursor_value=GREATEST(jpti_sync_cursors.cursor_value,EXCLUDED.cursor_value),updated_at=NOW()',
      [key, cursor]
    );
    return cursor;
  }
  cursorWriteQueue = cursorWriteQueue.catch(() => {}).then(async () => {
    let current = {};
    try { current = JSON.parse(await readFile(cursorsFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    current[key] = Math.max(Number(current[key]) || 0, cursor);
    await mkdir(dataDir, { recursive: true });
    const temp = cursorsFile + '.tmp';
    await writeFile(temp, JSON.stringify(current, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, cursorsFile);
  });
  await cursorWriteQueue;
  return cursor;
}

export function getStorageStatus() {
  return { backend, durable: backend === 'postgres', initialized, databaseConfigured: Boolean(process.env.DATABASE_URL) };
}

export async function closeStorage() {
  if (pool) { await pool.end(); pool = null; }
  initialized = false;
}
