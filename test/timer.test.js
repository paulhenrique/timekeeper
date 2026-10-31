'use strict';

// Timer rules (api/_timer.js) and the shared front-end core (assets/core.js).
// Run: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const { applyAction, initialState, ActionError } = require('../api/_timer');
const core = require('../assets/core');

const T0 = 1_000_000;

function withSteps() {
  return applyAction(
    initialState(),
    {
      action: 'setSteps',
      steps: [
        { id: 'opening', title: 'Opening', durationSec: 600 },
        { id: 'keynote', title: 'Keynote', durationSec: 1800 },
      ],
    },
    T0
  );
}




// ---------- Rules ----------

test('play, pause and play again only count running time', () => {
  let s = withSteps();
  s = applyAction(s, { action: 'play' }, T0);
  s = applyAction(s, { action: 'pause' }, T0 + 4000);
  assert.equal(s.elapsedBeforeMs, 4000);
  assert.equal(s.running, false);
  // paused time doesn't count
  s = applyAction(s, { action: 'play' }, T0 + 60_000);
  assert.equal(core.remainingMs(s, T0 + 61_000), 600_000 - 5000);
});

test('keeps counting into negative overtime', () => {
  let s = applyAction(withSteps(), { action: 'play' }, T0);
  const ms = core.remainingMs(s, T0 + 600_000 + 75_000);
  assert.equal(ms, -75_000);
  assert.equal(core.formatClock(ms), '-01:15');
  assert.equal(core.phase(s, T0 + 600_000 + 75_000), 'expired');
});

test('next step resets the clock and keeps running if it was running', () => {
  let s = applyAction(withSteps(), { action: 'play' }, T0);
  s = applyAction(s, { action: 'next' }, T0 + 700_000);
  assert.equal(s.currentIndex, 1);
  assert.equal(s.running, true);
  assert.equal(core.remainingMs(s, T0 + 710_000), 1_800_000 - 10_000);
  // on the last step, next does nothing
  s = applyAction(s, { action: 'next' }, T0 + 720_000);
  assert.equal(s.currentIndex, 1);
});

test('going back while paused stays paused with the full time', () => {
  let s = applyAction(withSteps(), { action: 'goto', index: 1 }, T0);
  s = applyAction(s, { action: 'prev' }, T0 + 5000);
  assert.equal(s.currentIndex, 0);
  assert.equal(s.running, false);
  assert.equal(core.remainingMs(s, T0 + 9000), 600_000);
});

test('+1 min and -1 min change the remaining time', () => {
  let s = applyAction(withSteps(), { action: 'play' }, T0);
  s = applyAction(s, { action: 'adjust', deltaSec: 60 }, T0 + 1000);
  assert.equal(core.remainingMs(s, T0 + 1000), 600_000 + 60_000 - 1000);
  s = applyAction(s, { action: 'adjust', deltaSec: -120 }, T0 + 1000);
  assert.equal(core.remainingMs(s, T0 + 1000), 600_000 - 60_000 - 1000);
});

test('restart step refills the time without stopping the clock', () => {
  let s = applyAction(withSteps(), { action: 'play' }, T0);
  s = applyAction(s, { action: 'resetStep' }, T0 + 300_000);
  assert.equal(s.running, true);
  assert.equal(core.remainingMs(s, T0 + 300_000), 600_000);
});

test('editing the agenda keeps the current step running if it is still there', () => {
  let s = applyAction(withSteps(), { action: 'goto', index: 1 }, T0);
  s = applyAction(s, { action: 'play' }, T0);
  s = applyAction(
    s,
    {
      action: 'setSteps',
      steps: [
        { id: 'keynote', title: 'Main keynote', durationSec: 1200 },
        { id: 'opening', title: 'Opening', durationSec: 600 },
      ],
    },
    T0 + 10_000
  );
  assert.equal(s.currentIndex, 0);
  assert.equal(s.running, true);
  assert.equal(core.remainingMs(s, T0 + 10_000), 1_200_000 - 10_000);
});

test('removing the current step stops and resets the clock', () => {
  let s = applyAction(withSteps(), { action: 'play' }, T0);
  s = applyAction(s, { action: 'setSteps', steps: [{ id: 'keynote', title: 'Keynote', durationSec: 1800 }] }, T0 + 5000);
  assert.equal(s.running, false);
  assert.equal(s.currentIndex, 0);
  assert.equal(core.remainingMs(s, T0 + 9000), 1_800_000);
});

test('an invalid agenda is rejected with a clear message', () => {
  assert.throws(() => applyAction(initialState(), { action: 'setSteps', steps: [{ title: '', durationSec: 60 }] }, T0), ActionError);
  assert.throws(() => applyAction(initialState(), { action: 'setSteps', steps: [{ title: 'X', durationSec: 0 }] }, T0), ActionError);
  assert.throws(() => applyAction(initialState(), { action: 'play' }, T0), /at least one step/);
  assert.throws(() => applyAction(withSteps(), { action: 'explodir' }, T0), /Unknown action/);
});

test('speaker messages are capped in length and expire', () => {
  let s = applyAction(withSteps(), { action: 'notify', text: `  ${'a'.repeat(300)}  ` }, T0);
  assert.equal(s.message.text.length, 140);
  assert.ok(core.activeMessage(s, T0 + 1000));
  assert.equal(core.activeMessage(s, T0 + core.MESSAGE_VISIBLE_MS + 1), null);
  s = applyAction(s, { action: 'clearMessage' }, T0 + 2000);
  assert.equal(s.message, null);
});

test('every action bumps the version', () => {
  let s = withSteps();
  const v = s.version;
  s = applyAction(s, { action: 'play' }, T0);
  assert.equal(s.version, v + 1);
});

// ---------- Formatting ----------

test('formatClock rounds like a stage timer', () => {
  assert.equal(core.formatClock(600_000), '10:00');
  assert.equal(core.formatClock(599_001), '10:00');
  assert.equal(core.formatClock(500), '00:01');
  assert.equal(core.formatClock(0), '00:00');
  assert.equal(core.formatClock(-500), '00:00');
  assert.equal(core.formatClock(-1000), '-00:01');
  assert.equal(core.formatClock(3_725_000), '1:02:05');
});

test('phase flags the last minute as a warning', () => {
  const s = applyAction(withSteps(), { action: 'play' }, T0);
  assert.equal(core.phase(s, T0 + 1000), 'normal');
  assert.equal(core.phase(s, T0 + 545_000), 'warning');
  assert.equal(core.phase(initialState(), T0), 'empty');
});

// ---------- Syncing (createSync) ----------

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function stateResponse(version) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ state: { ...initialState(), version }, serverNow: Date.now() }),
  };
}

test('a read sent during an action cannot undo the action on screen', async () => {
  global.document = { hidden: false };
  const pending = [];
  global.fetch = () => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  };
  const sync = core.createSync({ url: '/api/sessions/x', onState: () => {} });

  const post = sync.send({ action: 'play' });
  const read = sync.refresh(); // the server answered this read before storing the play
  pending[0].resolve(stateResponse(2));
  await post;
  pending[1].resolve(stateResponse(1));
  await read;
  assert.equal(sync.getState().version, 2);

  // A newer read with a lower version (state reset on the server) is accepted.
  const later = sync.refresh();
  pending[2].resolve(stateResponse(0));
  await later;
  assert.equal(sync.getState().version, 0);
  delete global.document;
});

test('a stalled request gives up after the timeout', async () => {
  global.document = { hidden: false };
  global.fetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const sync = core.createSync({ url: '/api/sessions/x', onState: () => {}, timeoutMs: 30 });
  await assert.rejects(sync.refresh(), /took too long/);
  delete global.document;
});
