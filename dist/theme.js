(function () {
  'use strict';
  const key = 'boothy-theme';
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch { /* Use the device preference when storage is unavailable. */ }
  let explicit = preference === 'dark' || preference === 'light';
  let theme = explicit ? preference : system?.matches ? 'dark' : 'light';
  function apply() {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#131a16' : '#f7f6f2');
    const toggle = document.querySelector('#theme-toggle');
    if (!toggle) return;
    const dark = theme === 'dark';
    toggle.setAttribute('aria-pressed', String(dark));
    toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
    toggle.setAttribute('title', `Switch to ${dark ? 'light' : 'dark'} mode`);
    toggle.innerHTML = `<svg aria-hidden="true"><use href="#i-${dark ? 'sun' : 'moon'}"/></svg><span>${dark ? 'Light' : 'Dark'}</span>`;
  }
  window.BoothyTheme = {
    sync: apply,
    toggle() {
      theme = theme === 'dark' ? 'light' : 'dark'; explicit = true;
      try { localStorage.setItem(key, theme); } catch { /* Keep the choice for this session. */ }
      apply();
    }
  };
  system?.addEventListener?.('change', event => {
    if (!explicit) { theme = event.matches ? 'dark' : 'light'; apply(); }
  });
  apply();
})();
