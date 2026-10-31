'use strict';

const { initialState } = require('../_timer');
const { StoreNotConfiguredError, StoreError, setJSON, incrementWindow } = require('../_store');
const { newSessionId, sessionKey, sessionTtlSec, createLimitPerHour, clientIp } = require('../_session');

// GET  /api/sessions -> { ttlSec }
// POST /api/sessions -> { id, ttlSec }
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // GET only tells the landing page how long sessions live.
  if (req.method === 'GET') {
    res.status(200).json({ ttlSec: sessionTtlSec() });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ status: 'error', message: 'Method not allowed' });
    return;
  }

  try {
    // Keeps a single visitor from burning through the free Redis/Vercel quota.
    const hour = Math.floor(Date.now() / 3_600_000);
    const count = await incrementWindow(`tk:rl:create:${clientIp(req)}:${hour}`, 3600);
    if (count > createLimitPerHour()) {
      res.status(429).json({ status: 'rate_limited', message: 'Too many sessions created from here. Try again later.' });
      return;
    }

    const state = { ...initialState(), updatedAt: Date.now() };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = newSessionId();
      if (await setJSON(sessionKey(id), state, sessionTtlSec(), { onlyIfAbsent: true })) {
        res.status(201).json({ id, ttlSec: sessionTtlSec() });
        return;
      }
    }
    res.status(500).json({ status: 'error', message: 'Could not create a session, try again' });
  } catch (err) {
    if (err instanceof StoreNotConfiguredError) {
      console.error('[sessions]', err.message);
      res.status(500).json({ status: 'storage_missing', message: err.message });
      return;
    }
    if (err instanceof StoreError) {
      res.status(502).json({ status: 'error', message: err.message });
      return;
    }
    console.error('[sessions] unexpected error', err);
    res.status(500).json({ status: 'error', message: 'Unexpected error' });
  }
};
