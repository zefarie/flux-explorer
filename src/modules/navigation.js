import { state, invoke, savePrefs } from './state.js';
import { showLoading, showToast, escapeHtml, escapeAttr } from './utils.js';
import { renderEntries } from './files.js';
import { updateSidebar } from './sidebar.js';
import { updateStatusBar } from './statusbar.js';
import { updateActiveTabName } from './tabs.js';

export async function navigateTo(path, addToHistory = true) {
  showLoading(true);
  try {
    const entries = await invoke('list_directory', { path, showHidden: state.showHidden });
    state.entries = entries;
    state.currentPath = path;
    state.selected.clear();
    state.lastSelected = null;
    state.searchQuery = '';
    document.getElementById('search-input').value = '';

    if (addToHistory) {
      state.history = state.history.slice(0, state.historyIndex + 1);
      state.history.push(path);
      state.historyIndex = state.history.length - 1;
    }

    renderBreadcrumb();
    renderEntries();
    updateNavButtons();
    updateSidebar();
    updateStatusBar();
    savePrefs();
    updateActiveTabName();
    invoke('watch_directory', { path }).catch(() => {});
  } catch (err) {
    showToast(err, 'error');
  }
  showLoading(false);
}

export async function goBack() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    await navigateTo(state.history[state.historyIndex], false);
  }
}

export async function goForward() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    await navigateTo(state.history[state.historyIndex], false);
  }
}

export async function goUp() {
  const parent = await invoke('get_parent', { path: state.currentPath });
  if (parent && parent !== state.currentPath) {
    await navigateTo(parent);
  }
}

export async function refresh() {
  await navigateTo(state.currentPath, false);
}

export function updateNavButtons() {
  document.getElementById('btn-back').disabled = state.historyIndex <= 0;
  document.getElementById('btn-forward').disabled = state.historyIndex >= state.history.length - 1;
}

// Breadcrumb

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = '';

  const parts = state.currentPath.split('/').filter(Boolean);
  let accumulated = '';

  const root = createBreadcrumbItem('/', '/');
  bc.appendChild(root);

  parts.forEach((part) => {
    accumulated += '/' + part;
    const path = accumulated;

    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '\u203a';
    bc.appendChild(sep);

    const item = createBreadcrumbItem(part, path);
    bc.appendChild(item);
  });

  bc.scrollLeft = bc.scrollWidth;
}

function createBreadcrumbItem(label, path) {
  const item = document.createElement('span');
  item.className = 'breadcrumb-item';
  item.textContent = label;
  item.addEventListener('click', () => navigateTo(path));
  return item;
}

// Path input

export function setupPathInput() {
  const bc = document.getElementById('breadcrumb');
  const input = document.getElementById('path-input');
  const acList = document.getElementById('autocomplete-list');
  let acIndex = -1;
  let acItems = [];
  let acTimeout = null;

  bc.addEventListener('click', (e) => {
    if (e.target.classList.contains('breadcrumb-item')) return;
    showPathInput();
  });

  bc.addEventListener('dblclick', (e) => {
    e.preventDefault();
    showPathInput();
  });

  input.addEventListener('input', () => {
    clearTimeout(acTimeout);
    acTimeout = setTimeout(() => fetchAutocomplete(input.value), 120);
  });

  input.addEventListener('keydown', (e) => {
    const visible = !acList.classList.contains('hidden') && acItems.length > 0;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (visible && acIndex >= 0 && acIndex < acItems.length) {
        applyCompletion(acItems[acIndex]);
      } else if (visible && acItems.length === 1) {
        applyCompletion(acItems[0]);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visible) {
        acIndex = Math.min(acIndex + 1, acItems.length - 1);
        updateAcHighlight();
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visible) {
        acIndex = Math.max(acIndex - 1, 0);
        updateAcHighlight();
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (visible && acIndex >= 0 && acIndex < acItems.length) {
        applyCompletion(acItems[acIndex]);
      } else {
        const path = input.value.trim();
        hidePathInput();
        if (path) navigateTo(path);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (visible) {
        hideAutocomplete();
      } else {
        hidePathInput();
      }
      return;
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      hideAutocomplete();
      hidePathInput();
    }, 150);
  });

  acList.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      applyCompletion(item.dataset.path);
    }
  });

  async function fetchAutocomplete(partial) {
    if (!partial || partial.length < 1) {
      hideAutocomplete();
      return;
    }
    try {
      const results = await invoke('autocomplete_path', { partial });
      acItems = results;
      acIndex = -1;
      if (results.length === 0) {
        hideAutocomplete();
        return;
      }
      renderAutocomplete(partial, results);
    } catch (_) {
      hideAutocomplete();
    }
  }

  function renderAutocomplete(partial, items) {
    const folderSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:var(--yellow)"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
    const fileSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg4)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

    acList.innerHTML = items.map((path, i) => {
      const isDir = path.endsWith('/');
      const name = path.replace(/\/$/, '').split('/').pop();
      return `<div class="autocomplete-item${i === acIndex ? ' active' : ''}" data-path="${escapeAttr(path)}">
        ${isDir ? folderSvg : fileSvg}
        <span>${highlightMatch(name, partial)}</span>
      </div>`;
    }).join('');
    acList.classList.remove('hidden');
  }

  function highlightMatch(name, partial) {
    const prefix = partial.replace(/\/$/, '').split('/').pop() || '';
    if (!prefix) return escapeHtml(name);
    const idx = name.toLowerCase().indexOf(prefix.toLowerCase());
    if (idx === -1) return escapeHtml(name);
    const before = name.slice(0, idx);
    const match = name.slice(idx, idx + prefix.length);
    const after = name.slice(idx + prefix.length);
    return `${escapeHtml(before)}<span class="autocomplete-match">${escapeHtml(match)}</span>${escapeHtml(after)}`;
  }

  function updateAcHighlight() {
    acList.querySelectorAll('.autocomplete-item').forEach((el, i) => {
      el.classList.toggle('active', i === acIndex);
      if (i === acIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function applyCompletion(path) {
    input.value = path;
    input.focus();
    input.setSelectionRange(path.length, path.length);
    if (path.endsWith('/')) {
      fetchAutocomplete(path);
    } else {
      hideAutocomplete();
    }
  }

  function hideAutocomplete() {
    acList.classList.add('hidden');
    acList.innerHTML = '';
    acItems = [];
    acIndex = -1;
  }
}

export function showPathInput() {
  const bc = document.getElementById('breadcrumb');
  const input = document.getElementById('path-input');
  bc.classList.add('hidden');
  input.classList.remove('hidden');
  input.value = state.currentPath;
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function hidePathInput() {
  const bc = document.getElementById('breadcrumb');
  const input = document.getElementById('path-input');
  input.classList.add('hidden');
  bc.classList.remove('hidden');
  document.getElementById('autocomplete-list').classList.add('hidden');
}
