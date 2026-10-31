// Every user-facing string lives here, so translating the app means editing one file.
(function (root) {
  'use strict';

  const STRINGS = {
    appName: 'Timekeeper',
    tagline: 'A shared stage timer. One link: control it from your phone, show it full screen on stage.',
    createSession: 'Create a session',
    creating: 'Creating…',
    how1: 'Create a session and build the agenda: “Opening, 10 min”, “Keynote, 30 min”…',
    how2: 'Open the same link on the stage screen and switch it to presentation mode.',
    how3: 'Play, pause, add time and send messages to the speaker. Overtime counts in red.',
    volatileNote: 'Sessions are temporary: they vanish {hours} hours after the last change. No account needed.',
    footerSource: 'Open source (MIT) on GitHub',
    footerCredit: 'Made by the DevItape community',
    createError: 'Could not create a session. Try again in a moment.',
    storageMissing: 'Storage is not set up yet: connect Upstash Redis to this Vercel project (see the README).',

    now: 'Now',
    upNext: 'Up next: {title}',
    lastStep: 'Last step of the agenda',
    noSteps: 'No steps yet',
    buildAgenda: 'Build the agenda below and save it',
    waiting: 'Waiting to start',
    running: 'Running',
    paused: 'Paused',
    overtime: 'Time’s up — counting overtime',
    play: '▶ Play',
    pause: '❚❚ Pause',
    prev: '⏮ Previous',
    next: 'Next ⏭',
    minusOne: '−1 min',
    plusOne: '+1 min',
    restartStep: '↺ Restart step',

    sessionLink: 'Session link:',
    copyLink: 'Copy link',
    linkCopied: 'Link copied',
    presentMode: 'Presentation mode',
    presentHint: 'On the stage screen, open this same link and tap “Presentation mode”.',
    expiresNote: 'This session vanishes {hours}h after the last change.',
    connected: '● connected',
    offline: '● offline',
    stagePreview: 'Stage preview',
    openInNewTab: 'open ↗',

    messageSpeaker: 'Message the speaker',
    preset5: 'Five minutes left',
    preset2: 'Two minutes left',
    presetWrap: 'Please wrap up',
    presetQa: 'Time for questions',
    presetMic: 'Speak closer to the mic',
    messagePlaceholder: 'Or type a message…',
    send: 'Send',
    onScreen: 'On screen:',
    goneIn: '(gone in {s}s)',
    removeMessage: 'Remove',
    messageSent: 'Message sent to the speaker',

    agenda: 'Agenda',
    unsaved: 'Unsaved changes',
    emptyAgenda: 'No steps yet. For example: Opening, 10 min.',
    addStep: '+ Add step',
    discard: 'Discard',
    saveAgenda: 'Save agenda',
    stepName: 'Step name',
    stepNameN: 'Name of step {n}',
    stepMinutesN: 'Minutes of step {n}',
    minutes: 'min',
    goToStep: 'Go to this step',
    moveUp: 'Move up',
    moveDown: 'Move down',
    removeStep: 'Remove step',
    saveFirst: 'Save the agenda before switching steps',
    alreadyCurrent: 'That is already the current step',
    agendaSaved: 'Agenda saved',
    savedButEdited: 'Saved — your latest edits are not saved yet',
    checkStep: 'Check step {n}: it needs a name and a duration',
    waitPrevious: 'Wait for the previous action to finish',
    tryAgain: 'That did not work, try again',

    noActivity: 'No activity',
    statusRunning: '● Running',
    statusPaused: '❚❚ Paused',
    emptyAgendaStage: 'Nothing on the agenda yet',
    timesUp: 'Time’s up',
    messageLabel: 'Message from the organizers',
    keepAwake: 'Tap here to keep the screen on',
    awakeOn: 'Screen stays on',
    awakeUnsupported: 'This browser can’t keep the screen on: adjust the device sleep settings',
    connectionLost: 'Connection lost — showing the last known time',
    holdToExit: 'Hold to exit',

    notFoundTitle: 'Session not found',
    notFoundBody: 'It may have expired: sessions vanish {hours} hours after the last change.',
    newSession: 'Create a new session',
  };

  function t(key, vars) {
    let text = STRINGS[key];
    if (text == null) return key;
    if (vars) Object.keys(vars).forEach((name) => (text = text.split(`{${name}}`).join(String(vars[name]))));
    return text;
  }

  // Fills static markup: data-t (text), data-t-placeholder, data-t-title (title + aria-label).
  function applyStrings(scope, vars) {
    const rootEl = scope || document;
    rootEl.querySelectorAll('[data-t]').forEach((el) => {
      el.textContent = t(el.dataset.t, vars);
    });
    rootEl.querySelectorAll('[data-t-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.tPlaceholder, vars);
    });
    rootEl.querySelectorAll('[data-t-title]').forEach((el) => {
      el.title = t(el.dataset.tTitle, vars);
      el.setAttribute('aria-label', el.title);
    });
  }

  root.TK = { STRINGS, t, applyStrings };
})(window);
