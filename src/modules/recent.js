import { escapeHtml, escapeAttr } from './utils.js';
import { navigateTo } from './navigation.js';

const RECENT_KEY = 'flux-explorer-recent';
const MAX_RECENT = 10;

let recents = [];

function load() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    recents = raw ? JSON.parse(raw) : [];
  } catch (_) {
    recents = [];
  }
}

function save() {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recents)); } catch (_) {}
}

export function trackVisit(path) {
  if (!path || path === '/') return;
  // Move to front, dedupe
  recents = recents.filter(p => p !== path);
  recents.unshift(path);
  if (recents.length > MAX_RECENT) recents = recents.slice(0, MAX_RECENT);
  save();
  renderRecents();
}

function renderRecents() {
  const container = document.getElementById('recents');
  const section = document.getElementById('recents-section');
  if (!container || !section) return;

  if (recents.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const folderSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

  container.innerHTML = recents.slice(0, 6).map(path => {
    const name = path.split('/').filter(Boolean).pop() || '/';
    return `<div class="sidebar-item" data-path="${escapeAttr(path)}">
      ${folderSvg}
      <span>${escapeHtml(name)}</span>
    </div>`;
  }).join('');
}

export function setupRecents() {
  load();
  renderRecents();
  const container = document.getElementById('recents');
  if (container) {
    container.addEventListener('click', (e) => {
      const item = e.target.closest('.sidebar-item');
      if (item) navigateTo(item.dataset.path);
    });
  }
}
