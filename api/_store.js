// Tiny key/value store for session state.
// Production: Upstash Redis over its REST API (no npm dependency).
// Local dev and tests (no Redis env vars, not on Vercel): an in-memory Map.
'use strict';

class StoreNotConfiguredError extends Error {
  constructor() {
    super('Storage is not configured: connect an Upstash Redis database to this Vercel project');
    this.name = 'StoreNotConfiguredError';
  }
}

class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}

// key -> { value, expiresAt }
const memory = new Map();

// The Vercel integration injects KV_REST_API_*; a direct Upstash account uses UPSTASH_REDIS_REST_*.
function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

// On Vercel an in-memory Map isn't shared between instances, so the control
// screen and the stage screen would see different timers. Fail loudly instead.
function useMemory() {
  if (redisConfig()) return false;
  if (process.env.VERCEL) throw new StoreNotConfiguredError();
  return true;
}

function memoryGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

async function redis(command) {
  const { url, token } = redisConfig();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
  } catch (err) {
    console.error('[store] network error talking to Redis', err);
    throw new StoreError('Could not reach storage');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body || body.error) {
    console.error('[store] Redis error', { status: res.status, error: body && body.error });
    throw new StoreError('Could not reach storage');
  }
  return body.result;
}

// With { refreshTtlSec } reading also pushes the expiry forward (one Redis command: GETEX).
async function getJSON(key, { refreshTtlSec } = {}) {
  let raw;
  if (useMemory()) {
    raw = memoryGet(key);
    if (raw !== null && refreshTtlSec) memory.get(key).expiresAt = Date.now() + refreshTtlSec * 1000;
  } else {
    raw = await redis(refreshTtlSec ? ['GETEX', key, 'EX', String(refreshTtlSec)] : ['GET', key]);
  }
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// With { onlyIfAbsent: true } nothing is written if the key exists; returns whether it wrote.
async function setJSON(key, value, ttlSec, { onlyIfAbsent = false } = {}) {
  const raw = JSON.stringify(value);
  if (useMemory()) {
    if (onlyIfAbsent && memoryGet(key) !== null) return false;
    memory.set(key, { value: raw, expiresAt: Date.now() + ttlSec * 1000 });
    return true;
  }
  const command = ['SET', key, raw, 'EX', String(ttlSec)];
  if (onlyIfAbsent) command.push('NX');
  return (await redis(command)) === 'OK';
}

// Fixed-window counter. The key is created with its expiry *before* counting
// (SET NX EX, then INCR keeps the TTL), so a crash between the two commands
// can never leave a counter that lives forever.
async function incrementWindow(key, windowSec) {
  if (useMemory()) {
    const current = Number(memoryGet(key)) || 0;
    const entry = memory.get(key);
    const expiresAt = entry && current ? entry.expiresAt : Date.now() + windowSec * 1000;
    memory.set(key, { value: String(current + 1), expiresAt });
    return current + 1;
  }
  await redis(['SET', key, '0', 'EX', String(windowSec), 'NX']);
  return Number(await redis(['INCR', key]));
}

module.exports = { StoreNotConfiguredError, StoreError, getJSON, setJSON, incrementWindow };
