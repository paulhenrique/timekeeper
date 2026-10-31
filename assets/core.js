// Shared timer core: remaining-time math, clock formatting and syncing
// with /api/sessions/:id. Works in the browser and in Node (for tests).
(function (root) {
  'use strict';

  // How long a message from the control screen stays on the stage screen.
  const MESSAGE_VISIBLE_MS = 60 * 1000;
  // Below this the clock turns amber (before the red of time's up).
  const WARNING_MS = 60 * 1000;
  const REQUEST_TIMEOUT_MS = 6000;

  function currentStep(state) {
    return (state && state.steps[state.currentIndex]) || null;
  }

  function nextStep(state) {
    return (state && state.steps[state.currentIndex + 1]) || null;
  }

  function elapsedMs(state, now) {
    const live = state.running && state.startedAt ? now - state.startedAt : 0;
    return state.elapsedBeforeMs + live;
  }

  function remainingMs(state, now) {
    const step = currentStep(state);
    if (!step) return null;
    return step.durationSec * 1000 - elapsedMs(state, now);
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // Positive rounds up (10:00 at the start, 00:00 only when it ends);
  // negative counts from -00:01 once the first full second is over.
  function formatClock(ms) {
    const totalSec = ms > 0 ? Math.ceil(ms / 1000) : Math.floor(-ms / 1000);
    const negative = ms <= 0 && totalSec > 0;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return negative ? `-${body}` : body;
  }

  function phase(state, now) {
    const ms = remainingMs(state, now);
    if (ms === null) return 'empty';
    if (ms <= 0) return 'expired';
    if (ms <= WARNING_MS) return 'warning';
    return 'normal';
  }

  function activeMessage(state, now) {
    const msg = state && state.message;
    if (!msg) return null;
    return now - msg.at < MESSAGE_VISIBLE_MS ? msg : null;
  }

  function formatDuration(sec) {
    const min = sec / 60;
    return Number.isInteger(min) ? `${min} min` : `${min.toFixed(1)} min`;
  }

  // Polls the session and corrects the local clock with the server time
  // (lowest round-trip sample), so every screen shows the same second.
  function createSync(options) {
    const url = options.url;
    const pollMs = options.pollMs || 2000;
    const hiddenPollMs = options.hiddenPollMs || pollMs;
    const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
    let offset = 0;
    let samples = [];
    let state = null;
    let timer = null;
    let stopped = false;
    // Event counter (send/apply) to order requests without relying on milliseconds.
    let tick = 0;
    let lastAppliedTick = 0;

    function recordClock(serverNow, sentAt, receivedAt) {
      if (typeof serverNow !== 'number') return;
      const rtt = receivedAt - sentAt;
      samples.push({ rtt, offset: serverNow + rtt / 2 - receivedAt });
      if (samples.length > 8) samples = samples.slice(-8);
      offset = samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
    }

    // Every server write bumps the version, so the highest is the newest.
    // A read sent while an action was in flight can come back with the old
    // version: it must not undo the action on screen. A lower version is only
    // accepted from a read sent after the last applied response (state reset).
    function shouldApply(incoming, isRead, sentTick) {
      if (!incoming) return false;
      if (!state || incoming.version >= state.version) return true;
      return isRead && sentTick > lastAppliedTick;
    }

    async function request(init, isRead) {
      const sentAt = Date.now();
      const sentTick = (tick += 1);
      // Venue Wi-Fi stalls connections: without a limit, polling would silently stop.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      let data = {};
      try {
        res = await fetch(url, { cache: 'no-store', ...init, signal: controller.signal });
        try {
          data = await res.json();
        } catch {
          data = {};
        }
      } catch {
        const err = new Error(
          controller.signal.aborted ? 'The server took too long to answer' : 'No connection to the server'
        );
        err.code = 'network';
        throw err;
      } finally {
        clearTimeout(timeout);
      }
      const receivedAt = Date.now();
      if (!res.ok) {
        const err = new Error(data.message || 'Could not reach the server');
        err.status = res.status;
        err.code = data.status;
        throw err;
      }
      recordClock(data.serverNow, sentAt, receivedAt);
      if (shouldApply(data.state, isRead, sentTick)) {
        state = data.state;
        lastAppliedTick = tick += 1;
        options.onState(state);
      }
      return data.state;
    }

    function schedule() {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(poll, document.hidden ? hiddenPollMs : pollMs);
    }

    async function poll() {
      try {
        await request(undefined, true);
        if (options.onOnline) options.onOnline();
      } catch (err) {
        if (options.onError) options.onError(err);
      } finally {
        schedule();
      }
    }

    return {
      start: poll,
      stop() {
        stopped = true;
        clearTimeout(timer);
      },
      refresh: () => request(undefined, true),
      now: () => Date.now() + offset,
      getState: () => state,
      send(payload) {
        return request(
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          false
        );
      },
    };
  }

  const api = {
    MESSAGE_VISIBLE_MS,
    currentStep,
    nextStep,
    remainingMs,
    formatClock,
    formatDuration,
    phase,
    activeMessage,
    createSync,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimerCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
