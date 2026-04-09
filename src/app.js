// ============================================
// FLUX EXPLORER — Application Logic
// ============================================

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

// Preferences persistence
const PREFS_KEY = 'flux-explorer-prefs';

function loadPrefs() {
  try {
    const saved = localStorage.getItem(PREFS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch (_) {
    return {};
  }
}

function savePrefs() {
  const prefs = {
    viewMode: state.viewMode,
    showHidden: state.showHidden,
    sortBy: state.sortBy,
    sortAsc: state.sortAsc,
    lastPath: state.currentPath,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (_) {}
}

const savedPrefs = loadPrefs();

// State
const state = {
  currentPath: '',
  entries: [],
  selected: new Set(),
  lastSelected: null,
  history: [],
  historyIndex: -1,
  viewMode: savedPrefs.viewMode || 'grid',
  showHidden: savedPrefs.showHidden || false,
  sortBy: savedPrefs.sortBy || 'name',
  sortAsc: savedPrefs.sortAsc !== undefined ? savedPrefs.sortAsc : true,
  searchQuery: '',
  contextTarget: null,
  clipboard: { paths: [], action: null }, // action: 'copy' | 'cut'
  previewOpen: false,
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  setupToolbar();
  setupPathInput();
  setupFileArea();
  setupDragDrop();
  setupKeyboard();
  setupContextMenu();
  setupDialogs();
  setupPreview();
  await loadQuickAccess();

  // Restore UI state from prefs
  document.getElementById('btn-view-grid').classList.toggle('active', state.viewMode === 'grid');
  document.getElementById('btn-view-list').classList.toggle('active', state.viewMode === 'list');
  document.getElementById('btn-hidden').classList.toggle('active', state.showHidden);

  const home = await invoke('get_home');
  const startPath = savedPrefs.lastPath || home;
  await navigateTo(startPath);
});

// ============================================
// TOOLBAR
// ============================================

function setupToolbar() {
  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-forward').addEventListener('click', goForward);
  document.getElementById('btn-up').addEventListener('click', goUp);
  document.getElementById('btn-refresh').addEventListener('click', refresh);

  document.getElementById('btn-view-grid').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('btn-view-list').addEventListener('click', () => setViewMode('list'));
  document.getElementById('btn-hidden').addEventListener('click', toggleHidden);

  const searchInput = document.getElementById('search-input');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = searchInput.value.trim();
      if (state.searchQuery.length > 0) {
        performSearch();
      } else {
        renderEntries();
      }
    }, 250);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      state.searchQuery = '';
      searchInput.blur();
      renderEntries();
    }
  });
}

// ============================================
// NAVIGATION
// ============================================

async function navigateTo(path, addToHistory = true) {
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
  } catch (err) {
    showToast(err, 'error');
  }
  showLoading(false);
}

async function goBack() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    await navigateTo(state.history[state.historyIndex], false);
  }
}

async function goForward() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    await navigateTo(state.history[state.historyIndex], false);
  }
}

async function goUp() {
  const parent = await invoke('get_parent', { path: state.currentPath });
  if (parent && parent !== state.currentPath) {
    await navigateTo(parent);
  }
}

async function refresh() {
  await navigateTo(state.currentPath, false);
}

function updateNavButtons() {
  document.getElementById('btn-back').disabled = state.historyIndex <= 0;
  document.getElementById('btn-forward').disabled = state.historyIndex >= state.history.length - 1;
}

// ============================================
// BREADCRUMB
// ============================================

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  bc.innerHTML = '';

  const parts = state.currentPath.split('/').filter(Boolean);
  let accumulated = '';

  // Root
  const root = createBreadcrumbItem('/', '/');
  bc.appendChild(root);

  parts.forEach((part, i) => {
    accumulated += '/' + part;
    const path = accumulated;

    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '›';
    bc.appendChild(sep);

    const item = createBreadcrumbItem(part, path);
    bc.appendChild(item);
  });

  // Scroll to end
  bc.scrollLeft = bc.scrollWidth;
}

function setupPathInput() {
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
    // Small delay to allow click on autocomplete item
    setTimeout(() => {
      hideAutocomplete();
      hidePathInput();
    }, 150);
  });

  acList.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent blur
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
    // Move cursor to end
    input.setSelectionRange(path.length, path.length);
    // If it's a directory, fetch new completions
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

function showPathInput() {
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

function createBreadcrumbItem(label, path) {
  const item = document.createElement('span');
  item.className = 'breadcrumb-item';
  item.textContent = label;
  item.addEventListener('click', () => navigateTo(path));
  return item;
}

// ============================================
// RENDERING
// ============================================

function renderEntries() {
  const container = document.getElementById('file-container');
  const emptyState = document.getElementById('empty-state');

  let entries = state.entries;

  // Filter by search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    entries = entries.filter(e => e.name.toLowerCase().includes(q));
  }

  // Sort
  entries = sortEntries(entries);

  if (entries.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    updateStatusBar(0);
    return;
  }

  emptyState.classList.add('hidden');
  container.className = state.viewMode === 'grid' ? 'view-grid' : 'view-list';

  let html = '';

  if (state.viewMode === 'list') {
    html += `<div class="list-header">
      <span data-sort="name" class="${state.sortBy === 'name' ? 'sort-active' : ''}">Nom ${state.sortBy === 'name' ? (state.sortAsc ? '↑' : '↓') : ''}</span>
      <span data-sort="size" class="${state.sortBy === 'size' ? 'sort-active' : ''}" style="text-align:right">Taille ${state.sortBy === 'size' ? (state.sortAsc ? '↑' : '↓') : ''}</span>
      <span data-sort="modified" class="${state.sortBy === 'modified' ? 'sort-active' : ''}">Modifie ${state.sortBy === 'modified' ? (state.sortAsc ? '↑' : '↓') : ''}</span>
    </div>`;
  }

  entries.forEach((entry, index) => {
    const iconInfo = getFileIcon(entry);
    const selectedClass = state.selected.has(entry.path) ? ' selected' : '';
    const hiddenClass = entry.is_hidden ? ' is-hidden' : '';
    const symlinkClass = entry.is_symlink ? ' is-symlink' : '';
    const cutClass = (state.clipboard.action === 'cut' && state.clipboard.paths.includes(entry.path)) ? ' is-cut' : '';
    const thumbType = getThumbType(entry);
    const thumbAttr = thumbType ? ` data-thumb="${thumbType}"` : '';

    if (state.viewMode === 'grid') {
      html += `<div class="file-item${selectedClass}${hiddenClass}${symlinkClass}${cutClass}"
                    data-path="${escapeAttr(entry.path)}"
                    data-index="${index}"
                    data-is-dir="${entry.is_dir}"
                    draggable="true"${thumbAttr}>
        <div class="file-icon ${iconInfo.colorClass}">${iconInfo.svg}</div>
        <div class="file-name">${escapeHtml(entry.name)}</div>
      </div>`;
    } else {
      html += `<div class="file-item${selectedClass}${hiddenClass}${symlinkClass}${cutClass}"
                    data-path="${escapeAttr(entry.path)}"
                    data-index="${index}"
                    data-is-dir="${entry.is_dir}"
                    draggable="true"${thumbAttr}>
        <div class="file-name-col">
          <div class="file-icon ${iconInfo.colorClass}">${iconInfo.svg}</div>
          <div class="file-name">${escapeHtml(entry.name)}</div>
        </div>
        <div class="file-size">${entry.is_dir ? '—' : formatSize(entry.size)}</div>
        <div class="file-date">${formatDate(entry.modified)}</div>
      </div>`;
    }
  });

  container.innerHTML = html;
  updateStatusBar(entries.length);
  loadThumbnails();

  // Setup list header sort clicks
  if (state.viewMode === 'list') {
    container.querySelector('.list-header')?.addEventListener('click', (e) => {
      const sortKey = e.target.closest('[data-sort]')?.dataset.sort;
      if (sortKey) {
        if (state.sortBy === sortKey) {
          state.sortAsc = !state.sortAsc;
        } else {
          state.sortBy = sortKey;
          state.sortAsc = true;
        }
        renderEntries();
        savePrefs();
      }
    });
  }
}

function setupFileArea() {
  const container = document.getElementById('file-container');

  container.addEventListener('click', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) {
      state.selected.clear();
      updateSelection();
      return;
    }

    const path = item.dataset.path;
    const index = parseInt(item.dataset.index);

    if (e.ctrlKey || e.metaKey) {
      if (state.selected.has(path)) {
        state.selected.delete(path);
      } else {
        state.selected.add(path);
      }
    } else if (e.shiftKey && state.lastSelected !== null) {
      const items = container.querySelectorAll('.file-item');
      const start = Math.min(state.lastSelected, index);
      const end = Math.max(state.lastSelected, index);
      state.selected.clear();
      for (let i = start; i <= end; i++) {
        state.selected.add(items[i]?.dataset.path);
      }
    } else {
      state.selected.clear();
      state.selected.add(path);
    }

    state.lastSelected = index;
    updateSelection();
  });

  container.addEventListener('dblclick', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;

    const path = item.dataset.path;
    const isDir = item.dataset.isDir === 'true';

    if (isDir) {
      navigateTo(path);
    } else {
      invoke('open_file', { path });
    }
  });
}

function updateSelection() {
  document.querySelectorAll('.file-item').forEach(item => {
    item.classList.toggle('selected', state.selected.has(item.dataset.path));
  });
  updateStatusBar();
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    // Dirs always first
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;

    let cmp = 0;
    switch (state.sortBy) {
      case 'name':
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'modified':
        cmp = a.modified - b.modified;
        break;
    }
    return state.sortAsc ? cmp : -cmp;
  });
}

// ============================================
// SEARCH
// ============================================

async function performSearch() {
  if (!state.searchQuery) return;

  showLoading(true);
  try {
    const results = await invoke('search_files', {
      path: state.currentPath,
      query: state.searchQuery,
      showHidden: state.showHidden,
    });
    state.entries = results;
    renderEntries();
  } catch (err) {
    showToast(err, 'error');
  }
  showLoading(false);
}

// ============================================
// VIEW MODE
// ============================================

function setViewMode(mode) {
  state.viewMode = mode;
  document.getElementById('btn-view-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-view-list').classList.toggle('active', mode === 'list');
  renderEntries();
  savePrefs();
}

function toggleHidden() {
  state.showHidden = !state.showHidden;
  document.getElementById('btn-hidden').classList.toggle('active', state.showHidden);
  savePrefs();
  navigateTo(state.currentPath, false);
}

// ============================================
// SIDEBAR
// ============================================

async function loadQuickAccess() {
  const items = await invoke('get_quick_access');
  const container = document.getElementById('quick-access');

  const icons = {
    home: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    desktop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    documents: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    downloads: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    images: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    music: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    videos: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    gaming: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><circle cx="15" cy="10" r="1" fill="currentColor"/><circle cx="18" cy="13" r="1" fill="currentColor"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>',
  };

  container.innerHTML = items.map(item => `
    <div class="sidebar-item" data-path="${escapeAttr(item.path)}">
      ${icons[item.icon] || icons.documents}
      <span>${escapeHtml(item.name)}</span>
    </div>
  `).join('');

  container.addEventListener('click', (e) => {
    const item = e.target.closest('.sidebar-item');
    if (item) navigateTo(item.dataset.path);
  });

  // Root disk click
  document.querySelector('#sidebar .sidebar-item[data-path="/"]')?.addEventListener('click', () => {
    navigateTo('/');
  });
}

function updateSidebar() {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('active', item.dataset.path === state.currentPath);
  });
}

// ============================================
// CONTEXT MENU
// ============================================

function setupContextMenu() {
  const menu = document.getElementById('context-menu');

  document.getElementById('file-area').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const item = e.target.closest('.file-item');

    if (item) {
      const path = item.dataset.path;
      if (!state.selected.has(path)) {
        state.selected.clear();
        state.selected.add(path);
        updateSelection();
      }
      state.contextTarget = path;
    } else {
      state.contextTarget = null;
      state.selected.clear();
      updateSelection();
    }

    // Show/hide context items based on target
    const hasTarget = state.contextTarget !== null;
    menu.querySelector('[data-action="open"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="copy"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="cut"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="paste"]').classList.toggle('hidden', state.clipboard.paths.length === 0);
    menu.querySelector('[data-action="rename"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="delete"]').classList.toggle('hidden', !hasTarget);

    // Position menu
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 300);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');
  });

  document.addEventListener('click', () => {
    menu.classList.add('hidden');
  });

  menu.addEventListener('click', (e) => {
    const action = e.target.closest('.ctx-item')?.dataset.action;
    if (!action) return;
    menu.classList.add('hidden');
    handleContextAction(action);
  });
}

function handleContextAction(action) {
  switch (action) {
    case 'open':
      if (state.contextTarget) {
        const entry = state.entries.find(e => e.path === state.contextTarget);
        if (entry?.is_dir) navigateTo(entry.path);
        else invoke('open_file', { path: state.contextTarget });
      }
      break;
    case 'open-terminal':
      invoke('open_terminal', { path: state.currentPath }).catch(e => showToast(e, 'error'));
      break;
    case 'copy':
      clipboardCopy();
      break;
    case 'cut':
      clipboardCut();
      break;
    case 'paste':
      clipboardPaste();
      break;
    case 'new-folder':
      showNewFolderDialog();
      break;
    case 'new-file':
      showNewFileDialog();
      break;
    case 'rename':
      if (state.contextTarget) showRenameDialog(state.contextTarget);
      break;
    case 'delete':
      showDeleteDialog();
      break;
  }
}

// ============================================
// DIALOGS
// ============================================

function setupDialogs() {
  // Rename
  document.getElementById('rename-cancel').addEventListener('click', () => hideDialog('rename'));
  document.getElementById('rename-confirm').addEventListener('click', confirmRename);
  document.getElementById('rename-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') hideDialog('rename');
  });

  // New Folder
  document.getElementById('newfolder-cancel').addEventListener('click', () => hideDialog('newfolder'));
  document.getElementById('newfolder-confirm').addEventListener('click', confirmNewFolder);
  document.getElementById('newfolder-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmNewFolder();
    if (e.key === 'Escape') hideDialog('newfolder');
  });

  // New File
  document.getElementById('newfile-cancel').addEventListener('click', () => hideDialog('newfile'));
  document.getElementById('newfile-confirm').addEventListener('click', confirmNewFile);
  document.getElementById('newfile-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmNewFile();
    if (e.key === 'Escape') hideDialog('newfile');
  });

  // Delete
  document.getElementById('delete-cancel').addEventListener('click', () => hideDialog('delete'));
  document.getElementById('delete-confirm').addEventListener('click', confirmDelete);
}

function showRenameDialog(path) {
  const entry = state.entries.find(e => e.path === path);
  if (!entry) return;

  const input = document.getElementById('rename-input');
  input.value = entry.name;
  input.dataset.path = path;

  document.getElementById('rename-overlay').classList.remove('hidden');

  requestAnimationFrame(() => {
    input.focus();
    // Select name without extension for files
    if (!entry.is_dir && entry.name.includes('.')) {
      input.setSelectionRange(0, entry.name.lastIndexOf('.'));
    } else {
      input.select();
    }
  });
}

async function confirmRename() {
  const input = document.getElementById('rename-input');
  const newName = input.value.trim();
  const path = input.dataset.path;
  if (!newName || !path) return;

  try {
    await invoke('rename_item', { path, newName });
    hideDialog('rename');
    await refresh();
  } catch (err) {
    showToast(err, 'error');
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = '', 1500);
  }
}

function showNewFolderDialog() {
  const input = document.getElementById('newfolder-input');
  input.value = '';
  document.getElementById('newfolder-overlay').classList.remove('hidden');
  requestAnimationFrame(() => input.focus());
}

async function confirmNewFolder() {
  const input = document.getElementById('newfolder-input');
  const name = input.value.trim();
  if (!name) return;

  try {
    await invoke('create_folder', { path: state.currentPath, name });
    hideDialog('newfolder');
    await refresh();
  } catch (err) {
    showToast(err, 'error');
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = '', 1500);
  }
}

function showNewFileDialog() {
  const input = document.getElementById('newfile-input');
  input.value = '';
  document.getElementById('newfile-overlay').classList.remove('hidden');
  requestAnimationFrame(() => input.focus());
}

async function confirmNewFile() {
  const input = document.getElementById('newfile-input');
  const name = input.value.trim();
  if (!name) return;

  try {
    await invoke('create_file', { path: state.currentPath, name });
    hideDialog('newfile');
    await refresh();
  } catch (err) {
    showToast(err, 'error');
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = '', 1500);
  }
}

function showDeleteDialog() {
  const paths = [...state.selected];
  if (paths.length === 0) return;

  const names = paths.map(p => {
    const entry = state.entries.find(e => e.path === p);
    return entry ? entry.name : p.split('/').pop();
  });

  const msg = paths.length === 1
    ? `Supprimer "${names[0]}" ?`
    : `Supprimer ${paths.length} elements ?`;

  document.getElementById('delete-message').textContent = msg;
  document.getElementById('delete-overlay').classList.remove('hidden');
  document.getElementById('delete-confirm').focus();
}

async function confirmDelete() {
  const paths = [...state.selected];
  if (paths.length === 0) return;

  try {
    await invoke('delete_items', { paths });
    hideDialog('delete');
    showToast(`${paths.length} element${paths.length > 1 ? 's' : ''} supprime${paths.length > 1 ? 's' : ''}`, 'success');
    await refresh();
  } catch (err) {
    showToast(err, 'error');
    hideDialog('delete');
  }
}

function hideDialog(name) {
  document.getElementById(`${name}-overlay`).classList.add('hidden');
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Don't handle if in input
    if (e.target.tagName === 'INPUT') return;

    // Ctrl+L — Edit path bar
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      showPathInput();
      return;
    }

    // Ctrl+F — Focus search
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      document.getElementById('search-input').focus();
      return;
    }

    // Ctrl+H — Toggle hidden
    if (e.ctrlKey && e.key === 'h') {
      e.preventDefault();
      toggleHidden();
      return;
    }

    // Ctrl+Shift+N — New folder
    if (e.ctrlKey && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      showNewFolderDialog();
      return;
    }

    // F2 — Rename
    if (e.key === 'F2' && state.selected.size === 1) {
      e.preventDefault();
      showRenameDialog([...state.selected][0]);
      return;
    }

    // F5 — Refresh
    if (e.key === 'F5') {
      e.preventDefault();
      refresh();
      return;
    }

    // Delete — Delete selected
    if (e.key === 'Delete' && state.selected.size > 0) {
      e.preventDefault();
      showDeleteDialog();
      return;
    }

    // Enter — Open selected
    if (e.key === 'Enter' && state.selected.size === 1) {
      e.preventDefault();
      const path = [...state.selected][0];
      const entry = state.entries.find(e => e.path === path);
      if (entry?.is_dir) navigateTo(entry.path);
      else invoke('open_file', { path });
      return;
    }

    // Backspace — Go up
    if (e.key === 'Backspace') {
      e.preventDefault();
      goUp();
      return;
    }

    // Alt+Left — Back
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
      return;
    }

    // Alt+Right — Forward
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      goForward();
      return;
    }

    // Alt+Up — Parent
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      goUp();
      return;
    }

    // Ctrl+C — Copy
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      clipboardCopy();
      return;
    }

    // Ctrl+X — Cut
    if (e.ctrlKey && e.key === 'x') {
      e.preventDefault();
      clipboardCut();
      return;
    }

    // Ctrl+V — Paste
    if (e.ctrlKey && e.key === 'v') {
      e.preventDefault();
      clipboardPaste();
      return;
    }

    // Space — Preview
    if (e.key === ' ' && state.selected.size === 1) {
      e.preventDefault();
      const path = [...state.selected][0];
      const entry = state.entries.find(e => e.path === path);
      if (entry && !entry.is_dir) openPreview(entry);
      return;
    }

    // Ctrl+A — Select all
    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      state.entries.forEach(e => state.selected.add(e.path));
      updateSelection();
      return;
    }

    // Escape — Clear selection
    if (e.key === 'Escape') {
      if (state.previewOpen) {
        closePreview();
        return;
      }
      state.selected.clear();
      updateSelection();
      return;
    }
  });
}

// ============================================
// STATUS BAR
// ============================================

function updateStatusBar(count) {
  const total = count ?? state.entries.length;
  document.getElementById('status-count').textContent = `${total} element${total !== 1 ? 's' : ''}`;

  const selCount = state.selected.size;
  const selEl = document.getElementById('status-selected');
  if (selCount > 0) {
    const selPaths = [...state.selected];
    const totalSize = selPaths.reduce((acc, path) => {
      const entry = state.entries.find(e => e.path === path);
      return acc + (entry?.size || 0);
    }, 0);
    let selText = `${selCount} selectionne${selCount > 1 ? 's' : ''}`;
    if (totalSize > 0) selText += ` — ${formatSize(totalSize)}`;
    if (selCount === 1) {
      const entry = state.entries.find(e => e.path === selPaths[0]);
      if (entry?.permissions) selText += ` — ${entry.permissions}`;
    }
    selEl.textContent = selText;
    selEl.classList.remove('hidden');
  } else {
    selEl.classList.add('hidden');
  }

  document.getElementById('status-path').textContent = state.currentPath;
}

// ============================================
// THUMBNAILS
// ============================================

const thumbCache = new Map();
let thumbObserver = null;

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'];
const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'];

function getThumbType(entry) {
  if (entry.is_dir) return null;
  if (IMAGE_EXTS.includes(entry.extension)) return 'image';
  if (VIDEO_EXTS.includes(entry.extension)) return 'video';
  return null;
}

function loadThumbnails() {
  if (thumbObserver) thumbObserver.disconnect();

  const items = document.querySelectorAll('.file-item[data-thumb]');
  if (items.length === 0) return;

  const size = state.viewMode === 'grid' ? 128 : 48;
  let loading = 0;
  const maxConcurrent = 6;
  const queue = [];

  function processQueue() {
    while (loading < maxConcurrent && queue.length > 0) {
      const item = queue.shift();
      if (!item.isConnected) continue;
      loadSingleThumb(item, size);
    }
  }

  async function loadSingleThumb(item, size) {
    const path = item.dataset.path;
    const type = item.dataset.thumb;
    const iconEl = item.querySelector('.file-icon');
    if (!iconEl) return;

    // Check cache
    const cacheKey = `${path}:${size}`;
    if (thumbCache.has(cacheKey)) {
      applyThumb(iconEl, thumbCache.get(cacheKey));
      return;
    }

    loading++;
    try {
      let dataUrl;
      if (type === 'image') {
        dataUrl = await invoke('get_thumbnail', { path, size });
      } else {
        dataUrl = await invoke('get_video_thumbnail', { path, size });
      }
      thumbCache.set(cacheKey, dataUrl);
      if (item.isConnected) applyThumb(iconEl, dataUrl);
    } catch (_) {
      // Keep the default icon on error
    }
    loading--;
    processQueue();
  }

  thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        queue.push(entry.target);
        thumbObserver.unobserve(entry.target);
      }
    }
    processQueue();
  }, { root: document.getElementById('file-area'), rootMargin: '100px' });

  items.forEach(item => thumbObserver.observe(item));
}

function applyThumb(iconEl, dataUrl) {
  iconEl.className = 'file-icon thumb-loaded';
  iconEl.innerHTML = `<img src="${dataUrl}" alt="">`;
}

// ============================================
// FILE ICONS
// ============================================

function getFileIcon(entry) {
  if (entry.is_dir) {
    return {
      colorClass: 'icon-folder',
      svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
    };
  }

  const ext = entry.extension;
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'];
  const audioExts = ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'opus'];
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'lua', 'sh', 'bash', 'zsh', 'fish', 'html', 'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'graphql', 'vue', 'svelte'];
  const archiveExts = ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z', 'zst'];
  const docExts = ['pdf', 'doc', 'docx', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'];
  const textExts = ['txt', 'md', 'log', 'cfg', 'conf', 'ini', 'env'];

  if (imageExts.includes(ext)) {
    return { colorClass: 'icon-image', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' };
  }
  if (videoExts.includes(ext)) {
    return { colorClass: 'icon-video', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' };
  }
  if (audioExts.includes(ext)) {
    return { colorClass: 'icon-audio', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' };
  }
  if (codeExts.includes(ext)) {
    return { colorClass: 'icon-code', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' };
  }
  if (archiveExts.includes(ext)) {
    return { colorClass: 'icon-archive', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>' };
  }
  if (docExts.includes(ext)) {
    return { colorClass: 'icon-document', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' };
  }
  if (textExts.includes(ext)) {
    return { colorClass: 'icon-text', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' };
  }

  // Executable
  if (entry.name.endsWith('.AppImage') || entry.name.endsWith('.run')) {
    return { colorClass: 'icon-exec', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' };
  }

  return { colorClass: 'icon-default', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' };
}

// ============================================
// UTILITIES
// ============================================

function formatSize(bytes) {
  if (bytes === 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fileDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  if (fileDate.getTime() === today.getTime()) {
    return `Aujourd'hui ${time}`;
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (fileDate.getTime() === yesterday.getTime()) {
    return `Hier ${time}`;
  }

  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + time;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

// ============================================
// CLIPBOARD (COPY / CUT / PASTE)
// ============================================

function clipboardCopy() {
  if (state.selected.size === 0) return;
  state.clipboard = { paths: [...state.selected], action: 'copy' };
  showToast(`${state.clipboard.paths.length} element${state.clipboard.paths.length > 1 ? 's' : ''} copie${state.clipboard.paths.length > 1 ? 's' : ''}`, 'info');
  renderEntries();
}

function clipboardCut() {
  if (state.selected.size === 0) return;
  state.clipboard = { paths: [...state.selected], action: 'cut' };
  showToast(`${state.clipboard.paths.length} element${state.clipboard.paths.length > 1 ? 's' : ''} coupe${state.clipboard.paths.length > 1 ? 's' : ''}`, 'info');
  renderEntries();
}

async function clipboardPaste() {
  if (state.clipboard.paths.length === 0 || !state.clipboard.action) return;

  const dest = state.currentPath;
  const sources = state.clipboard.paths;
  const action = state.clipboard.action;

  // Don't paste into the same directory for cut (would be a no-op)
  if (action === 'cut') {
    const allSameDir = sources.every(s => {
      const parent = s.substring(0, s.lastIndexOf('/')) || '/';
      return parent === dest;
    });
    if (allSameDir) {
      showToast('Impossible de deplacer au meme endroit', 'error');
      return;
    }
  }

  try {
    if (action === 'copy') {
      await invoke('copy_items', { sources, destination: dest });
      showToast(`${sources.length} element${sources.length > 1 ? 's' : ''} colle${sources.length > 1 ? 's' : ''}`, 'success');
    } else {
      await invoke('move_items', { sources, destination: dest });
      showToast(`${sources.length} element${sources.length > 1 ? 's' : ''} deplace${sources.length > 1 ? 's' : ''}`, 'success');
      state.clipboard = { paths: [], action: null };
    }
    await refresh();
  } catch (err) {
    showToast(err, 'error');
  }
}

// ============================================
// DRAG & DROP
// ============================================

function setupDragDrop() {
  const container = document.getElementById('file-container');
  const fileArea = document.getElementById('file-area');
  let dragPaths = [];

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;

    const path = item.dataset.path;

    // If dragging a non-selected item, select only it
    if (!state.selected.has(path)) {
      state.selected.clear();
      state.selected.add(path);
      updateSelection();
    }

    dragPaths = [...state.selected];
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', dragPaths.join('\n'));

    // Mark dragged items
    requestAnimationFrame(() => {
      document.querySelectorAll('.file-item').forEach(el => {
        if (state.selected.has(el.dataset.path)) {
          el.classList.add('dragging');
        }
      });
    });
  });

  container.addEventListener('dragend', () => {
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    fileArea.classList.remove('drag-over-area');
    dragPaths = [];
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    const item = e.target.closest('.file-item');

    // Clear previous highlights
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    if (item && item.dataset.isDir === 'true' && !dragPaths.includes(item.dataset.path)) {
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
      item.classList.add('drag-over');
    } else {
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    }
  });

  container.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.file-item');
    if (item) item.classList.remove('drag-over');
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    fileArea.classList.remove('drag-over-area');

    if (dragPaths.length === 0) return;

    const item = e.target.closest('.file-item');
    let dest = state.currentPath;

    if (item && item.dataset.isDir === 'true' && !dragPaths.includes(item.dataset.path)) {
      dest = item.dataset.path;
    }

    // Don't drop on self
    if (dragPaths.some(p => p === dest)) return;

    try {
      if (e.ctrlKey) {
        await invoke('copy_items', { sources: dragPaths, destination: dest });
        showToast(`${dragPaths.length} element${dragPaths.length > 1 ? 's' : ''} copie${dragPaths.length > 1 ? 's' : ''}`, 'success');
      } else {
        await invoke('move_items', { sources: dragPaths, destination: dest });
        showToast(`${dragPaths.length} element${dragPaths.length > 1 ? 's' : ''} deplace${dragPaths.length > 1 ? 's' : ''}`, 'success');
      }
      await refresh();
    } catch (err) {
      showToast(err, 'error');
    }

    dragPaths = [];
  });

  // Drag over file area (for dropping in current dir)
  fileArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dragPaths.length > 0 && !e.target.closest('.file-item')) {
      fileArea.classList.add('drag-over-area');
    }
  });

  fileArea.addEventListener('dragleave', (e) => {
    if (!fileArea.contains(e.relatedTarget)) {
      fileArea.classList.remove('drag-over-area');
    }
  });
}

// ============================================
// FILE PREVIEW
// ============================================

const PREVIEW_TEXT_EXTS = ['txt', 'md', 'log', 'cfg', 'conf', 'ini', 'env', 'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'lua', 'sh', 'bash', 'zsh', 'fish', 'html', 'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'graphql', 'vue', 'svelte', 'Makefile', 'Dockerfile'];
const PREVIEW_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'];

function setupPreview() {
  document.getElementById('preview-close').addEventListener('click', closePreview);
  document.getElementById('preview-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'preview-overlay') closePreview();
  });
}

async function openPreview(entry) {
  const overlay = document.getElementById('preview-overlay');
  const content = document.getElementById('preview-content');
  const filename = document.getElementById('preview-filename');
  const meta = document.getElementById('preview-meta');

  filename.textContent = entry.name;
  const metaParts = [];
  if (!entry.is_dir) metaParts.push(formatSize(entry.size));
  if (entry.permissions) metaParts.push(entry.permissions);
  meta.textContent = metaParts.join(' — ');

  content.innerHTML = '<div class="spinner"></div>';
  overlay.classList.remove('hidden');
  state.previewOpen = true;

  const ext = entry.extension;

  if (PREVIEW_IMAGE_EXTS.includes(ext)) {
    // Image preview — use thumbnail for large images, direct for small
    try {
      const dataUrl = await invoke('get_thumbnail', { path: entry.path, size: 800 });
      content.innerHTML = `<img src="${dataUrl}" alt="${escapeAttr(entry.name)}">`;
    } catch (_) {
      content.innerHTML = `<img src="file://${entry.path}" alt="${escapeAttr(entry.name)}">`;
    }
  } else if (PREVIEW_TEXT_EXTS.includes(ext) || entry.name.startsWith('.') || entry.size < 500000) {
    // Text preview
    try {
      const text = await invoke('read_text_preview', { path: entry.path, maxLines: 200 });
      content.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
    } catch (_) {
      showPreviewInfo(content, entry);
    }
  } else {
    showPreviewInfo(content, entry);
  }
}

function showPreviewInfo(content, entry) {
  const iconInfo = getFileIcon(entry);
  content.innerHTML = `
    <div class="preview-info">
      <div class="preview-icon ${iconInfo.colorClass}">${iconInfo.svg}</div>
      <table>
        <tr><td>Nom</td><td>${escapeHtml(entry.name)}</td></tr>
        <tr><td>Taille</td><td>${formatSize(entry.size)}</td></tr>
        <tr><td>Modifie</td><td>${formatDate(entry.modified)}</td></tr>
        <tr><td>Permissions</td><td>${entry.permissions || '—'}</td></tr>
        ${entry.is_symlink ? '<tr><td>Type</td><td>Lien symbolique</td></tr>' : ''}
      </table>
    </div>
  `;
}

function closePreview() {
  document.getElementById('preview-overlay').classList.add('hidden');
  document.getElementById('preview-content').innerHTML = '';
  state.previewOpen = false;
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(String(message))}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}
