(function () {
  'use strict';

  const { t, applyStrings } = window.TK;
  const createBtn = document.getElementById('create');
  const errorEl = document.getElementById('create-error');
  const note = document.getElementById('volatile-note');

  applyStrings();

  fetch('/api/sessions', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.ttlSec) note.textContent = t('volatileNote', { hours: Math.round(data.ttlSec / 3600) });
    })
    .catch(() => {});

  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true;
    createBtn.textContent = t('creating');
    errorEl.hidden = true;
    try {
      const res = await fetch('/api/sessions', { method: 'POST', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        errorEl.textContent =
          data.status === 'storage_missing' ? t('storageMissing') : data.message || t('createError');
        errorEl.hidden = false;
        createBtn.disabled = false;
        createBtn.textContent = t('createSession');
        return;
      }
      // Keep the button disabled while the browser navigates, so a double click can't create two sessions.
      location.href = `/s/${data.id}`;
      return;
    } catch {
      errorEl.textContent = t('createError');
      errorEl.hidden = false;
    }
    createBtn.disabled = false;
    createBtn.textContent = t('createSession');
  });
})();
