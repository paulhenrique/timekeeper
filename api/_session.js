// Helpers shared by the session routes.
'use strict';

const crypto = require('crypto');
const { initialState } = require('./_timer');

// No look-alike characters (0/o, 1/l/i), so IDs are easy to read aloud or type.
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ID_LENGTH = 10; // ~49 bits: not guessable for sessions that live a few hours
const ID_RE = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`);

function newSessionId() {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i += 1) id += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)];
  return id;
}

function isSessionId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function sessionKey(id) {
  return `tk:session:${id}`;
}

function positiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Sessions are volatile: they disappear this long after nobody has used them.
function sessionTtlSec() {
  return Math.max(1, Math.round(positiveNumberEnv('SESSION_TTL_HOURS', 12) * 3600));
}

function createLimitPerHour() {
  return Math.round(positiveNumberEnv('CREATE_LIMIT_PER_HOUR', 30));
}

function readBody(req) {
  // On Vercel, req.body is a getter that throws on malformed JSON.
  let body;
  try {
    body = req.body;
  } catch {
    return {};
  }
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string' && body.length) {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

// One IPv6 client usually controls a whole /64, so rate limits key on that prefix.
function ipv6Prefix64(ip) {
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = ip.includes('::') ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

function clientIp(req) {
  const headers = req.headers || {};
  const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(headers['x-real-ip'] || '') || 'unknown';
  if (ip.includes(':') && !ip.startsWith('::ffff:')) return ipv6Prefix64(ip);
  return ip.replace(/^::ffff:/, '');
}

// Fills in anything a stored state might be missing, so old or partial data never crashes.
function normalizeState(stored) {
  const state = { ...initialState(), ...(stored && typeof stored === 'object' ? stored : {}) };
  if (!Array.isArray(state.steps)) state.steps = [];
  return state;
}

module.exports = {
  newSessionId,
  isSessionId,
  sessionKey,
  sessionTtlSec,
  createLimitPerHour,
  readBody,
  clientIp,
  normalizeState,
};
