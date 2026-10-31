'use strict';

// Session routes: create, read, act, expire, rate limit, storage wiring.
// Run: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
}

const ENV_KEYS = [
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'VERCEL',
  'SESSION_TTL_HOURS',
  'CREATE_LIMIT_PER_HOUR',
];

function clearEnv() {
  ENV_KEYS.forEach((key) => delete process.env[key]);
}

// Fresh modules = fresh in-memory store for every test.
function load() {
  ['../api/_store', '../api/_session', '../api/sessions/index', '../api/sessions/[id]'].forEach((m) => {
    delete require.cache[require.resolve(m)];
  });
  return {
    create: require('../api/sessions/index'),
    session: require('../api/sessions/[id]'),
  };
}

async function call(handler, req) {
  const res = fakeRes();
  await handler({ headers: { 'x-forwarded-for': '203.0.113.7' }, query: {}, ...req }, res);
  return res;
}

async function newSession(api) {
  const res = await call(api.create, { method: 'POST' });
  assert.equal(res.statusCode, 201);
  return res.body.id;
}

test('creating a session returns a readable, unguessable id', async () => {
  clearEnv();
  const api = load();
  const a = await newSession(api);
  const b = await newSession(api);
  assert.match(a, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
  assert.notEqual(a, b);
});

test('a new session starts empty and can be driven by actions', async () => {
  clearEnv();
  const api = load();
  const id = await newSession(api);

  let res = await call(api.session, { method: 'GET', query: { id } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.state.steps, []);
  assert.equal(typeof res.body.serverNow, 'number');
  assert.equal(res.headers['Cache-Control'], 'no-store');

  await call(api.session, {
    method: 'POST',
    query: { id },
    body: { action: 'setSteps', steps: [{ id: 'o', title: 'Opening', durationSec: 600 }] },
  });
  await call(api.session, { method: 'POST', query: { id }, body: { action: 'play' } });
  res = await call(api.session, { method: 'GET', query: { id } });
  assert.equal(res.body.state.steps[0].title, 'Opening');
  assert.equal(res.body.state.running, true);
});

test('sessions are isolated from each other', async () => {
  clearEnv();
  const api = load();
  const a = await newSession(api);
  const b = await newSession(api);
  await call(api.session, {
    method: 'POST',
    query: { id: a },
    body: { action: 'setSteps', steps: [{ id: 'o', title: 'Only in A', durationSec: 60 }] },
  });
  const res = await call(api.session, { method: 'GET', query: { id: b } });
  assert.deepEqual(res.body.state.steps, []);
});

test('unknown, malformed or expired sessions answer 404', async () => {
  clearEnv();
  process.env.SESSION_TTL_HOURS = '0.0001'; // ~0.36s
  const api = load();
  const id = await newSession(api);

  assert.equal((await call(api.session, { method: 'GET', query: { id: 'zzzzzzzzzz' } })).statusCode, 404);
  assert.equal((await call(api.session, { method: 'GET', query: { id: '../etc' } })).statusCode, 404);
  assert.equal(
    (await call(api.session, { method: 'POST', query: { id: 'zzzzzzzzzz' }, body: { action: 'play' } })).statusCode,
    404
  );

  await new Promise((r) => setTimeout(r, 450));
  const res = await call(api.session, { method: 'GET', query: { id } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.status, 'not_found');
});

test('invalid actions and malformed JSON answer 400', async () => {
  clearEnv();
  const api = load();
  const id = await newSession(api);
  let res = await call(api.session, { method: 'POST', query: { id }, body: { action: 'play' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /at least one step/);

  const req = { method: 'POST', headers: {}, query: { id } };
  Object.defineProperty(req, 'body', {
    get() {
      throw new Error('Invalid JSON');
    },
  });
  res = fakeRes();
  await api.session(req, res);
  assert.equal(res.statusCode, 400);
});

test('session creation is rate limited per visitor', async () => {
  clearEnv();
  process.env.CREATE_LIMIT_PER_HOUR = '2';
  const api = load();
  assert.equal((await call(api.create, { method: 'POST' })).statusCode, 201);
  assert.equal((await call(api.create, { method: 'POST' })).statusCode, 201);
  const blocked = await call(api.create, { method: 'POST' });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.status, 'rate_limited');
  // someone else still can
  const other = await call(api.create, { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.1' } });
  assert.equal(other.statusCode, 201);
});

test('GET /api/sessions tells how long sessions live', async () => {
  clearEnv();
  process.env.SESSION_TTL_HOURS = '6';
  const api = load();
  const res = await call(api.create, { method: 'GET' });
  assert.equal(res.body.ttlSec, 6 * 3600);
});

test('on Vercel without Redis, says storage_missing instead of using memory', async () => {
  clearEnv();
  process.env.VERCEL = '1';
  const api = load();
  const res = await call(api.create, { method: 'POST' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, 'storage_missing');
  clearEnv();
});

test('with Redis configured, talks to the Upstash REST API', async () => {
  clearEnv();
  process.env.KV_REST_API_URL = 'https://fake.upstash.io';
  process.env.KV_REST_API_TOKEN = 'tok';
  const db = new Map();
  const commands = [];
  global.fetch = async (url, init) => {
    const command = JSON.parse(init.body);
    commands.push({ url, auth: init.headers.Authorization, command });
    const [op, key, value] = command;
    let result = null;
    if (op === 'INCR') {
      result = (Number(db.get(key)) || 0) + 1;
      db.set(key, String(result));
    } else if (op === 'EXPIRE') result = 1;
    else if (op === 'SET') {
      if (command.includes('NX') && db.has(key)) result = null;
      else {
        db.set(key, value);
        result = 'OK';
      }
    } else if (op === 'GET') result = db.get(key) ?? null;
    return { ok: true, status: 200, json: async () => ({ result }) };
  };

  const api = load();
  const id = await newSession(api);
  const res = await call(api.session, { method: 'GET', query: { id } });

  assert.equal(res.statusCode, 200);
  assert.ok(commands.every((c) => c.url === 'https://fake.upstash.io' && c.auth === 'Bearer tok'));
  const set = commands.find((c) => c.command[0] === 'SET');
  assert.equal(set.command[1], `tk:session:${id}`);
  assert.deepEqual(set.command.slice(3), ['EX', String(12 * 3600), 'NX']);
  assert.ok(commands.some((c) => c.command[0] === 'EXPIRE'));
  clearEnv();
});

test('a Redis failure answers 502', async () => {
  clearEnv();
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'WRONGPASS' }) });
  const api = load();
  const res = await call(api.create, { method: 'POST' });
  assert.equal(res.statusCode, 502);
  clearEnv();
});
