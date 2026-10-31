(function () {
  'use strict';

  const core = window.TimerCore;
  const { t, applyStrings } = window.TK;
  const $ = (id) => document.getElementById(id);

  // /s/<id> is rewritten to this page (vercel.json); the ID stays in the address bar.
  const sessionId = location.pathname.split('/').filter(Boolean)[1] || '';
  const params = new URLSearchParams(location.search);
  // ?preview=1 is the stage preview inside the control screen: same view, no fullscreen/wake lock.
  const isPreview = params.get('preview') === '1';
  const MODE_KEY = `tk:mode:${sessionId}`;
  const HOLD_TO_EXIT_MS = 1500;
  let renderTimer = null;

  applyStrings();

  // ================= Shared =================

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function showMissing() {
    sync.stop();
    mode = 'missing';
    clearInterval(renderTimer);
    // Nothing to show anymore: let the device sleep and leave fullscreen.
    releaseWakeLock();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    document.body.className = 'mode-missing';
    fetchTtlHours().then((hours) => setText($('missing-body'), t('notFoundBody', { hours: hours || 12 })));
  }

  let ttlHoursPromise = null;
  function fetchTtlHours() {
    if (!ttlHoursPromise) {
      ttlHoursPromise = fetch('/api/sessions', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (data && data.ttlSec ? Math.round(data.ttlSec / 3600) : null))
        .catch(() => null);
    }
    return ttlHoursPromise;
  }

  // The stage preview inside control mode doesn't poll: the parent page posts it its state.
  function createPreviewFeed() {
    let state = null;
    let offset = 0;
    window.addEventListener('message', (event) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.type !== 'tk:state' || !data.state) return;
      state = data.state;
      offset = Number(data.offset) || 0;
      onState(state);
    });
    return {
      start() {},
      stop() {},
      now: () => Date.now() + offset,
      getState: () => state,
      send: () => Promise.resolve(null),
    };
  }

  let failingSince = null;
  const sync = isPreview ? createPreviewFeed() : core.createSync({
    url: `/api/sessions/${encodeURIComponent(sessionId)}`,
    pollMs: 2000,
    hiddenPollMs: 10000,
    onState: onState,
    onOnline: () => {
      failingSince = null;
      setText($('conn'), t('connected'));
      $('conn').className = 'tka-conn is-ok';
      setText($('stage-conn'), '');
      $('setup-alert').hidden = true;
    },
    onError: (err) => {
      if (err.code === 'not_found') {
        showMissing();
        return;
      }
      if (err.code === 'storage_missing') $('setup-alert').hidden = false;
      setText($('conn'), t('offline'));
      $('conn').className = 'tka-conn is-error';
      if (!failingSince) failingSince = Date.now();
      // A single failed poll is noise; only warn the stage when it lasts.
      if (Date.now() - failingSince > 5000) setText($('stage-conn'), t('connectionLost'));
    },
  });

  // ================= Modes =================

  let mode = 'control';

  function initialMode() {
    if (isPreview || location.hash === '#present') return 'present';
    try {
      return localStorage.getItem(MODE_KEY) === 'present' ? 'present' : 'control';
    } catch {
      return 'control';
    }
  }

  async function setMode(next, { fromGesture = false } = {}) {
    mode = next;
    document.body.classList.toggle('mode-control', mode === 'control');
    document.body.classList.toggle('mode-present', mode === 'present');
    if (isPreview) return;

    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Private mode etc.: the mode just won't survive a reload.
    }
    if (location.hash === '#present' && mode === 'control') history.replaceState(null, '', location.pathname);

    const frame = $('preview');
    if (mode === 'present') {
      // The stage device has no use for the preview: unload it.
      frame.src = 'about:blank';
      previewLoaded = false;
      if (fromGesture) await enterFullscreen();
      requestWakeLock();
    } else {
      document.body.classList.remove('is-expired');
      releaseWakeLock();
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      if (!previewLoaded) {
        frame.src = `/s/${sessionId}?preview=1`;
        previewLoaded = true;
      }
      scalePreview();
    }
    updateFullscreenButton();
    render();
  }

  async function enterFullscreen() {
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // No fullscreen (e.g. iPhone) is fine; keeping the screen on is what matters.
    }
  }

  $('enter-present').addEventListener('click', () => setMode('present', { fromGesture: true }));

  // After a reload in presentation mode the browser won't go fullscreen on its own (needs a tap).
  const fullscreenBtn = $('fullscreen-btn');
  function updateFullscreenButton() {
    fullscreenBtn.hidden =
      mode !== 'present' || isPreview || !document.fullscreenEnabled || Boolean(document.fullscreenElement);
  }
  fullscreenBtn.addEventListener('click', enterFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);

  // Leaving presentation mode takes a deliberate press-and-hold, so a stray tap on stage does nothing.
  const exitBtn = $('exit-present');
  let holdTimer = null;
  function startHold(event) {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.repeat || holdTimer) return;
    event.preventDefault();
    exitBtn.classList.add('is-holding');
    holdTimer = setTimeout(() => {
      cancelHold();
      setMode('control');
    }, HOLD_TO_EXIT_MS);
  }
  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    exitBtn.classList.remove('is-holding');
  }
  exitBtn.addEventListener('pointerdown', startHold);
  exitBtn.addEventListener('keydown', startHold);
  ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur'].forEach((type) =>
    exitBtn.addEventListener(type, cancelHold)
  );
  exitBtn.addEventListener('contextmenu', (event) => event.preventDefault());

  // ================= Keep the screen on (like a video player) =================

  let wakeLock = null;
  const wakeHint = $('wake-hint');
  const wakeStatus = $('wake-status');

  async function requestWakeLock() {
    if (mode !== 'present' || isPreview || wakeLock) return;
    if (!('wakeLock' in navigator)) {
      setText(wakeStatus, t('awakeUnsupported'));
      wakeHint.hidden = true;
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      setText(wakeStatus, t('awakeOn'));
      wakeHint.hidden = true;
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        if (mode === 'present' && document.visibilityState === 'visible') wakeHint.hidden = false;
      });
    } catch {
      setText(wakeStatus, '');
      wakeHint.hidden = false;
    }
  }

  function releaseWakeLock() {
    wakeHint.hidden = true;
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // Browsers drop the wake lock when the tab is hidden; ask again when it's back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
  wakeHint.addEventListener('click', async () => {
    await enterFullscreen();
    requestWakeLock();
  });

  // Hide an idle mouse cursor over the stage clock.
  let cursorTimer = null;
  document.addEventListener('mousemove', () => {
    document.body.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
  });

  // ================= Presentation view =================

  let lastMessageId = null;

  function stageStatus(state, phase) {
    if (!state.steps.length) return t('emptyAgendaStage');
    if (state.running) return phase === 'expired' ? '' : t('statusRunning');
    if (state.elapsedBeforeMs === 0) return t('waiting');
    return t('statusPaused');
  }

  function renderStage(state, now) {
    const stage = $('stage');
    const step = core.currentStep(state);
    const next = core.nextStep(state);
    const phase = core.phase(state, now);

    setText($('stage-current'), step ? step.title : t('noActivity'));
    $('stage-arrow').hidden = !next;
    $('stage-next').hidden = !next;
    setText($('stage-next'), next ? t('upNext', { title: next.title }) : '');
    const clockText = step ? core.formatClock(core.remainingMs(state, now)) : '--:--';
    setText($('stage-clock'), clockText);
    // "1:02:05" is wider than "02:05": shrink it so it never overflows.
    stage.classList.toggle('has-hours', clockText.split(':').length === 3);

    stage.classList.toggle('is-warning', phase === 'warning');
    stage.classList.toggle('is-expired', phase === 'expired');
    stage.classList.toggle('is-paused', !state.running && state.steps.length > 0);
    document.body.classList.toggle('is-expired', phase === 'expired');
    $('stage-expired').hidden = phase !== 'expired';
    setText($('stage-status'), stageStatus(state, phase));

    const msg = core.activeMessage(state, now);
    const box = $('stage-message');
    box.hidden = !msg;
    stage.classList.toggle('has-message', Boolean(msg));
    if (msg && msg.id !== lastMessageId) {
      $('stage-message-text').textContent = msg.text;
      // Restart the "just arrived" flash for every new message.
      box.classList.remove('is-new');
      void box.offsetWidth;
      box.classList.add('is-new');
    }
    lastMessageId = msg ? msg.id : null;
  }

  // ================= Control view =================

  // The agenda is edited as a local draft and only sent on save, so polling never wipes what's being typed.
  let draft = [];
  let dirty = false;
  // Counts edits: if someone typed while a save was in flight, the draft stays unsaved.
  let draftRev = 0;
  let lastServerSteps = '';
  let busy = false;

  const toast = $('toast');
  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.hidden = true;
    }, 4000);
  }

  async function send(payload) {
    if (busy) {
      showToast(t('waitPrevious'));
      return null;
    }
    busy = true;
    document.body.classList.add('is-busy');
    try {
      return await sync.send(payload);
    } catch (err) {
      if (err.code === 'not_found') {
        showMissing();
        return null;
      }
      if (err.code === 'storage_missing') $('setup-alert').hidden = false;
      showToast(err.message || t('tryAgain'));
      return null;
    } finally {
      busy = false;
      document.body.classList.remove('is-busy');
    }
  }

  function renderControl(state, now) {
    const step = core.currentStep(state);
    const next = core.nextStep(state);
    const phase = core.phase(state, now);

    setText($('now-title'), step ? step.title : t('noSteps'));
    setText($('now-next'), next ? t('upNext', { title: next.title }) : step ? t('lastStep') : '');
    setText($('now-clock'), step ? core.formatClock(core.remainingMs(state, now)) : '--:--');
    $('now-clock').dataset.phase = phase;

    let status = t('waiting');
    if (!step) status = t('buildAgenda');
    else if (state.running) status = phase === 'expired' ? t('overtime') : t('running');
    else if (state.elapsedBeforeMs !== 0) status = t('paused');
    setText($('now-status'), status);

    setText($('play-toggle'), state.running ? t('pause') : t('play'));
    $('play-toggle').disabled = !step;
    document.querySelector('[data-action="prev"]').disabled = state.currentIndex <= 0;
    document.querySelector('[data-action="next"]').disabled = state.currentIndex >= state.steps.length - 1;

    const msg = core.activeMessage(state, now);
    $('active-message').hidden = !msg;
    if (msg) {
      setText($('active-message-text'), msg.text);
      const left = Math.ceil((core.MESSAGE_VISIBLE_MS - (now - msg.at)) / 1000);
      setText($('active-message-left'), t('goneIn', { s: left }));
    }
  }

  $('play-toggle').addEventListener('click', () => {
    const state = sync.getState();
    if (state) send({ action: state.running ? 'pause' : 'play' });
  });

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => send({ action: btn.dataset.action }));
  });

  document.querySelectorAll('[data-adjust]').forEach((btn) => {
    btn.addEventListener('click', () => send({ action: 'adjust', deltaSec: Number(btn.dataset.adjust) }));
  });

  async function notify(text) {
    const ok = await send({ action: 'notify', text });
    if (ok) showToast(t('messageSent'));
    return ok;
  }

  document.querySelectorAll('[data-preset]').forEach((chip) => {
    chip.addEventListener('click', () => notify(t(chip.dataset.preset)));
  });

  $('notify-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('notify-input');
    const text = input.value.trim();
    if (!text) return;
    if (await notify(text)) input.value = '';
  });

  $('clear-message').addEventListener('click', () => send({ action: 'clearMessage' }));

  // ---------- Agenda editor ----------

  const stepsList = $('steps-list');

  function newStepId() {
    return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function fromServer(steps) {
    return steps.map((s) => ({ id: s.id, title: s.title, minutes: s.durationSec / 60 }));
  }

  function setDirty(value) {
    if (value) draftRev += 1;
    dirty = value;
    $('steps-dirty').hidden = !dirty;
    $('save-steps').disabled = !dirty;
    $('discard-steps').disabled = !dirty;
    stepsList.classList.toggle('is-dirty', dirty);
  }

  function iconButton(label, titleKey, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tka-icon-btn';
    btn.textContent = label;
    btn.title = t(titleKey);
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderSteps() {
    stepsList.innerHTML = '';
    $('steps-empty').hidden = draft.length > 0;

    draft.forEach((step, index) => {
      const li = document.createElement('li');
      li.className = 'tka-step';
      li.dataset.index = String(index);

      const go = iconButton('▶', 'goToStep', () => {
        if (dirty) {
          showToast(t('saveFirst'));
          return;
        }
        // Going to the current step would reset its clock; that's what "Restart step" is for.
        const current = sync.getState();
        if (current && current.currentIndex === index) {
          showToast(t('alreadyCurrent'));
          return;
        }
        send({ action: 'goto', index });
      });
      go.classList.add('tka-step-go');

      const title = document.createElement('input');
      title.className = 'tka-step-title';
      title.type = 'text';
      title.maxLength = 80;
      title.value = step.title;
      title.placeholder = t('stepName');
      title.setAttribute('aria-label', t('stepNameN', { n: index + 1 }));
      title.addEventListener('input', () => {
        step.title = title.value;
        setDirty(true);
      });

      const minutes = document.createElement('input');
      minutes.className = 'tka-step-min';
      minutes.type = 'number';
      minutes.min = '0.5';
      minutes.step = '0.5';
      minutes.value = String(step.minutes);
      minutes.setAttribute('aria-label', t('stepMinutesN', { n: index + 1 }));
      minutes.addEventListener('input', () => {
        step.minutes = Number(minutes.value);
        setDirty(true);
      });

      const unit = document.createElement('span');
      unit.className = 'tka-muted';
      unit.textContent = t('minutes');

      const up = iconButton('↑', 'moveUp', () => move(index, -1));
      up.disabled = index === 0;
      const down = iconButton('↓', 'moveDown', () => move(index, 1));
      down.disabled = index === draft.length - 1;
      const remove = iconButton('✕', 'removeStep', () => {
        draft.splice(index, 1);
        setDirty(true);
        renderSteps();
      });

      li.append(go, title, minutes, unit, up, down, remove);
      stepsList.appendChild(li);
    });

    highlightCurrent(sync.getState());
  }

  function highlightCurrent(state) {
    const current = state && core.currentStep(state);
    stepsList.querySelectorAll('.tka-step').forEach((li) => {
      const step = draft[Number(li.dataset.index)];
      li.classList.toggle('is-current', Boolean(current && step && step.id === current.id));
    });
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    [draft[index], draft[target]] = [draft[target], draft[index]];
    setDirty(true);
    renderSteps();
  }

  $('add-step').addEventListener('click', () => {
    draft.push({ id: newStepId(), title: '', minutes: 10 });
    setDirty(true);
    renderSteps();
    const inputs = stepsList.querySelectorAll('.tka-step-title');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  $('discard-steps').addEventListener('click', () => {
    const state = sync.getState();
    draft = fromServer(state ? state.steps : []);
    setDirty(false);
    renderSteps();
  });

  $('save-steps').addEventListener('click', async () => {
    const invalid = draft.findIndex((s) => !s.title.trim() || !(s.minutes > 0));
    if (invalid >= 0) {
      showToast(t('checkStep', { n: invalid + 1 }));
      return;
    }
    const steps = draft.map((s) => ({
      id: s.id,
      title: s.title.trim(),
      durationSec: Math.max(1, Math.round(s.minutes * 60)),
    }));
    const savedRev = draftRev;
    const state = await send({ action: 'setSteps', steps });
    if (!state) return;
    if (draftRev === savedRev) {
      setDirty(false);
      lastServerSteps = '';
      onState(state);
      showToast(t('agendaSaved'));
    } else {
      showToast(t('savedButEdited'));
    }
  });

  // ---------- Link, preview ----------

  const sessionUrl = `${location.origin}/s/${sessionId}`;
  setText($('session-link'), sessionUrl.replace(/^https?:\/\//, ''));
  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      showToast(t('linkCopied'));
    } catch {
      showToast(sessionUrl);
    }
  });

  fetchTtlHours().then((hours) => {
    if (hours) setText($('expires-note'), t('expiresNote', { hours }));
  });

  // The preview is the real stage view at 1280×720, scaled down to fit the card.
  // It gets its state from this page via postMessage instead of polling on its own.
  let previewLoaded = false;
  function postToPreview() {
    const frame = $('preview');
    const state = sync.getState();
    if (isPreview || mode !== 'control' || !previewLoaded || !state || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ type: 'tk:state', state, offset: sync.now() - Date.now() }, location.origin);
  }
  $('preview').addEventListener('load', postToPreview);

  const previewBox = $('preview-box');
  function scalePreview() {
    $('preview').style.transform = `scale(${previewBox.clientWidth / 1280})`;
  }
  new ResizeObserver(scalePreview).observe(previewBox);

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });

  // ================= Wiring =================

  function onState(state) {
    const serverSteps = JSON.stringify(state.steps);
    if (!dirty && serverSteps !== lastServerSteps) {
      draft = fromServer(state.steps);
      lastServerSteps = serverSteps;
      renderSteps();
    } else {
      highlightCurrent(state);
    }
    postToPreview();
    render();
  }

  function render() {
    const state = sync.getState();
    if (!state) return;
    const now = sync.now();
    if (mode === 'present') renderStage(state, now);
    else renderControl(state, now);
  }

  if (!/^[a-z0-9]{6,32}$/.test(sessionId)) {
    showMissing();
    return;
  }

  if (isPreview) document.body.classList.add('is-preview');
  setMode(initialMode());
  sync.start();
  renderTimer = setInterval(render, 100);
})();
