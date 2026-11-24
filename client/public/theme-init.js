// Runs before the app bundle so the page paints in the right theme with no
// flash of light colours. It is a separate file, not an inline script, because
// the API's Content-Security-Policy only allows same-origin scripts.
// Keep the storage key and values in sync with client/src/lib/theme.js.
(function () {
  var stored;
  try {
    stored = localStorage.getItem('theme');
  } catch (e) {
    // Storage can be unavailable (privacy mode); fall back to the system.
  }
  var dark =
    stored === 'dark' ||
    (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
