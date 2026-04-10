const THEME_KEY = 'flux-explorer-theme';

export function setupTheme() {
  const select = document.getElementById('theme-select');
  if (!select) return;

  const saved = localStorage.getItem(THEME_KEY) || 'gruvbox';
  applyTheme(saved);
  select.value = saved;

  select.addEventListener('change', () => {
    applyTheme(select.value);
    try { localStorage.setItem(THEME_KEY, select.value); } catch (_) {}
  });
}

function applyTheme(theme) {
  if (theme === 'gruvbox') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
