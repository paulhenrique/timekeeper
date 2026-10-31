'use strict';

const { ActionError, applyAction } = require('../_timer');
const { StoreNotConfiguredError, StoreError, getJSON, setJSON } = require('../_store');
const { isSessionId, sessionKey, sessionTtlSec, readBody, normalizeState } = require('../_session');

// GET  /api/sessions/:id -> { state, serverNow }
// POST /api/sessions/:id  { action, ... } -> { state, serverNow }
module.exports = async function handler(req, res) {
  // serverNow is used by clients to sync their clocks: never cache.
  res.setHeader('Cache-Control', 'no-store');

  const id = req.query && req.query.id;
  if (!isSessionId(id)) {
    res.status(404).json({ status: 'not_found', message: 'Session not found' });
    return;
  }

  try {
    // Any screen opening the session keeps it alive; it only vanishes after a stretch with nobody using it.
    const stored = await getJSON(sessionKey(id), { refreshTtlSec: sessionTtlSec() });
    if (!stored) {
      res.status(404).json({ status: 'not_found', message: 'This session does not exist or has expired' });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({ state: normalizeState(stored), serverNow: Date.now(), ttlSec: sessionTtlSec() });
      return;
    }

    if (req.method === 'POST') {
      const state = applyAction(normalizeState(stored), readBody(req), Date.now());
      await setJSON(sessionKey(id), state, sessionTtlSec());
      res.status(200).json({ state, serverNow: Date.now(), ttlSec: sessionTtlSec() });
      return;
    }

    res.status(405).json({ status: 'error', message: 'Method not allowed' });
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(400).json({ status: 'invalid', message: err.message });
      return;
    }
    if (err instanceof StoreNotConfiguredError) {
      console.error('[session]', err.message);
      res.status(500).json({ status: 'storage_missing', message: err.message });
      return;
    }
    if (err instanceof StoreError) {
      res.status(502).json({ status: 'error', message: err.message });
      return;
    }
    console.error('[session] unexpected error', err);
    res.status(500).json({ status: 'error', message: 'Unexpected error' });
  }
};
