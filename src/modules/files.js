import { state, invoke, savePrefs } from './state.js';
import { escapeHtml, escapeAttr, formatSize, formatDate } from './utils.js';
import { getFileIcon } from './icons.js';
import { getThumbType, loadThumbnails, cleanupThumbnails } from './thumbnails.js';
import { updateStatusBar } from './statusbar.js';
import { navigateTo } from './navigation.js';
import { getGitClass } from './git.js';
import { applyFilters } from './filters.js';

// Virtual scroll config
const VIRTUAL_THRESHOLD = 500;
const LIST_ITEM_HEIGHT = 37;
const GRID_ITEM_HEIGHT = 130;
const BUFFER = 10;

let currentEntries = [];
let virtualActive = false;
let lastVisibleRange = null;
let scrollHandler = null;
let thumbsDebounceTimer = null;
let sortHeaderHandler = null;

function scheduleLoadThumbnails() {
  if (thumbsDebounceTimer) clearTimeout(thumbsDebounceTimer);
  thumbsDebounceTimer = setTimeout(() => {
    thumbsDebounceTimer = null;
    loadThumbnails();
  }, 80);
}

// Case-insensitive collator: much faster than toLowerCase()+localeCompare per comparison
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'accent' });

export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;

    let cmp = 0;
    switch (state.sortBy) {
      case 'name':
        cmp = nameCollator.compare(a.name, b.name);
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'modified':
        cmp = a.modified - b.modified;
        break;
      case 'type':
        cmp = nameCollator.compare(a.extension, b.extension) || nameCollator.compare(a.name, b.name);
        break;
    }
    return state.sortAsc ? cmp : -cmp;
  });
}

// Entries as currently displayed (search + filters + sort applied)
export function getCurrentEntries() {
  return currentEntries;
}

function renderItemHtml(entry, index) {
  const iconInfo = getFileIcon(entry);
  let cls = 'file-item';
  if (state.selected.has(entry.path)) cls += ' selected';
  if (entry.is_hidden) cls += ' is-hidden';
  if (entry.is_symlink) cls += ' is-symlink';
  if (state.clipboard.action === 'cut' && state.clipboard.paths.includes(entry.path)) cls += ' is-cut';
  cls += getGitClass(entry.path);

  const thumbType = getThumbType(entry);
  const open = `<div class="${cls}"
                  data-path="${escapeAttr(entry.path)}"
                  data-index="${index}"
                  data-is-dir="${entry.is_dir}"
                  draggable="true"${thumbType ? ` data-thumb="${thumbType}"` : ''}>`;
  const icon = `<div class="file-icon ${iconInfo.colorClass}">${iconInfo.svg}</div>`;
  const name = `<div class="file-name">${escapeHtml(entry.name)}</div>`;

  if (state.viewMode === 'grid') {
    return `${open}${icon}${name}</div>`;
  }
  return `${open}
      <div class="file-name-col">${icon}${name}</div>
      <div class="file-type">${entry.is_dir ? 'Dossier' : (entry.extension ? entry.extension.toUpperCase() : '-')}</div>
      <div class="file-size">${entry.is_dir ? '-' : formatSize(entry.size)}</div>
      <div class="file-date">${formatDate(entry.modified)}</div>
    </div>`;
}

const LIST_COLUMNS = [
  ['name', 'Nom', ''],
  ['type', 'Type', ''],
  ['size', 'Taille', ' style="text-align:right"'],
  ['modified', 'Modifi\u00e9', ''],
];

function getListHeader() {
  const cols = LIST_COLUMNS.map(([key, label, style]) => {
    const active = state.sortBy === key;
    const arrow = active ? (state.sortAsc ? '\u2191' : '\u2193') : '';
    return `<span data-sort="${key}" class="${active ? 'sort-active' : ''}"${style}>${label} ${arrow}</span>`;
  }).join('');
  return `<div class="list-header">${cols}</div>`;
}

function cleanupVirtual() {
  const fileArea = document.getElementById('file-area');
  if (scrollHandler) {
    fileArea.removeEventListener('scroll', scrollHandler);
    scrollHandler = null;
  }
  virtualActive = false;
  lastVisibleRange = null;
  const container = document.getElementById('file-container');
  container.style.paddingTop = '';
  container.style.paddingBottom = '';
  if (thumbsDebounceTimer) {
    clearTimeout(thumbsDebounceTimer);
    thumbsDebounceTimer = null;
  }
}

function getGridColumns() {
  const container = document.getElementById('file-container');
  const width = container.clientWidth;
  return Math.max(1, Math.floor(width / 126)); // 110px min + 8px gap + padding
}

function renderVisibleItems() {
  const fileArea = document.getElementById('file-area');
  const container = document.getElementById('file-container');
  const scrollTop = fileArea.scrollTop;
  const viewHeight = fileArea.clientHeight;

  let itemHeight, columns;
  if (state.viewMode === 'list') {
    itemHeight = LIST_ITEM_HEIGHT;
    columns = 1;
  } else {
    columns = getGridColumns();
    itemHeight = GRID_ITEM_HEIGHT;
  }

  const totalRows = Math.ceil(currentEntries.length / columns);
  const startRow = Math.max(0, Math.floor(scrollTop / itemHeight) - BUFFER);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewHeight) / itemHeight) + BUFFER);

  const startIdx = startRow * columns;
  const endIdx = Math.min(currentEntries.length, endRow * columns);

  // Skip if range hasn't changed
  const rangeKey = `${startIdx}-${endIdx}`;
  if (rangeKey === lastVisibleRange) return;
  lastVisibleRange = rangeKey;

  // Render visible items
  let html = '';
  if (state.viewMode === 'list') html += getListHeader();
  for (let i = startIdx; i < endIdx; i++) {
    html += renderItemHtml(currentEntries[i], i);
  }

  container.style.paddingTop = (startRow * itemHeight) + 'px';
  container.style.paddingBottom = Math.max(0, (totalRows - endRow) * itemHeight) + 'px';
  cleanupThumbnails();
  container.innerHTML = html;

  scheduleLoadThumbnails();
}

function handleSortClick(e) {
  const sortEl = e.target.closest('[data-sort]');
  if (!sortEl) return;
  if (!sortEl.closest('.list-header')) return;
  const sortKey = sortEl.dataset.sort;
  if (state.sortBy === sortKey) {
    state.sortAsc = !state.sortAsc;
  } else {
    state.sortBy = sortKey;
    state.sortAsc = true;
  }
  renderEntries();
  savePrefs();
}

function ensureSortHandler() {
  if (sortHeaderHandler) return;
  const container = document.getElementById('file-container');
  sortHeaderHandler = handleSortClick;
  container.addEventListener('click', sortHeaderHandler);
}

export function renderEntries() {
  const container = document.getElementById('file-container');
  const emptyState = document.getElementById('empty-state');

  let entries = state.entries;

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    entries = entries.filter(e => e.name.toLowerCase().includes(q));
  }

  entries = applyFilters(entries);
  entries = sortEntries(entries);
  currentEntries = entries;

  if (entries.length === 0) {
    cleanupVirtual();
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    updateStatusBar(0);
    return;
  }

  emptyState.classList.add('hidden');
  container.className = state.viewMode === 'grid' ? 'view-grid' : 'view-list';

  if (entries.length >= VIRTUAL_THRESHOLD) {
    // Virtual scroll mode
    virtualActive = true;
    lastVisibleRange = null;
    const fileArea = document.getElementById('file-area');
    if (!scrollHandler) {
      scrollHandler = () => requestAnimationFrame(renderVisibleItems);
      fileArea.addEventListener('scroll', scrollHandler);
    }
    renderVisibleItems();
  } else {
    // Normal render
    cleanupVirtual();
    let html = '';
    if (state.viewMode === 'list') html += getListHeader();
    entries.forEach((entry, index) => { html += renderItemHtml(entry, index); });
    cleanupThumbnails();
    container.innerHTML = html;
    loadThumbnails();
  }

  ensureSortHandler();
  updateStatusBar(entries.length);
}

export function setupFileArea() {
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
      // For virtual scroll, use currentEntries instead of DOM items
      const start = Math.min(state.lastSelected, index);
      const end = Math.max(state.lastSelected, index);
      state.selected.clear();
      for (let i = start; i <= end; i++) {
        if (currentEntries[i]) state.selected.add(currentEntries[i].path);
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

export function updateSelection() {
  document.querySelectorAll('.file-item').forEach(item => {
    item.classList.toggle('selected', state.selected.has(item.dataset.path));
  });
  updateStatusBar();
}

export function setViewMode(mode) {
  state.viewMode = mode;
  document.getElementById('btn-view-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-view-list').classList.toggle('active', mode === 'list');
  renderEntries();
  savePrefs();
}

export function toggleHidden() {
  state.showHidden = !state.showHidden;
  document.getElementById('btn-hidden').classList.toggle('active', state.showHidden);
  savePrefs();
  navigateTo(state.currentPath, false);
}
