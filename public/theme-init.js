// Runs before React and styles paint; CSP permits this same-origin script.
;(function () {
  var saved = null
  try { saved = window.localStorage.getItem('voxhold.theme.v1') } catch (_) { /* Storage may be disabled. */ }
  var theme = saved === 'dark' || saved === 'light' ? saved
    : window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f2ed' : '#10100f')
})()
