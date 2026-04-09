import { state, invoke, savePrefs } from './state.js';
import { escapeHtml, escapeAttr, formatSize, formatDate } from './utils.js';
import { getFileIcon } from './icons.js';
import { getThumbType, loadThumbnails } from './thumbnails.js';
import { updateStatusBar } from './statusbar.js';
import { navigateTo } from './navigation.js';

// Virtual scroll config
const VIRTUAL_THRESHOLD = 500;
const LIST_ITEM_HEIGHT = 37;
const GRID_ITEM_HEIGHT = 130;
const BUFFER = 10;

let currentEntries = [];
let virtualActive = false;
let lastVisibleRange = null;
let scrollHandler = null;

export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
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
      case 'type':
        cmp = a.extension.localeCompare(b.extension) || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
    }
    return state.sortAsc ? cmp : -cmp;
  });
}

function renderItemHtml(entry, index) {
  const iconInfo = getFileIcon(entry);
  const selectedClass = state.selected.has(entry.path) ? ' selected' : '';
  const hiddenClass = entry.is_hidden ? ' is-hidden' : '';
  const symlinkClass = entry.is_symlink ? ' is-symlink' : '';
  const cutClass = (state.clipboard.action === 'cut' && state.clipboard.paths.includes(entry.path)) ? ' is-cut' : '';
  const thumbType = getThumbType(entry);
  const thumbAttr = thumbType ? ` data-thumb="${thumbType}"` : '';

  if (state.viewMode === 'grid') {
    return `<div class="file-item${selectedClass}${hiddenClass}${symlinkClass}${cutClass}"
                  data-path="${escapeAttr(entry.path)}"
                  data-index="${index}"
                  data-is-dir="${entry.is_dir}"
                  draggable="true"${thumbAttr}>
      <div class="file-icon ${iconInfo.colorClass}">${iconInfo.svg}</div>
      <div class="file-name">${escapeHtml(entry.name)}</div>
    </div>`;
  } else {
    return `<div class="file-item${selectedClass}${hiddenClass}${symlinkClass}${cutClass}"
                  data-path="${escapeAttr(entry.path)}"
                  data-index="${index}"
                  data-is-dir="${entry.is_dir}"
                  draggable="true"${thumbAttr}>
      <div class="file-name-col">
        <div class="file-icon ${iconInfo.colorClass}">${iconInfo.svg}</div>
        <div class="file-name">${escapeHtml(entry.name)}</div>
      </div>
      <div class="file-type">${entry.is_dir ? 'Dossier' : (entry.extension ? entry.extension.toUpperCase() : '-')}</div>
      <div class="file-size">${entry.is_dir ? '-' : formatSize(entry.size)}</div>
      <div class="file-date">${formatDate(entry.modified)}</div>
    </div>`;
  }
}

function getListHeader() {
  return `<div class="list-header">
    <span data-sort="name" class="${state.sortBy === 'name' ? 'sort-active' : ''}">Nom ${state.sortBy === 'name' ? (state.sortAsc ? '\u2191' : '\u2193') : ''}</span>
    <span data-sort="type" class="${state.sortBy === 'type' ? 'sort-active' : ''}">Type ${state.sortBy === 'type' ? (state.sortAsc ? '\u2191' : '\u2193') : ''}</span>
    <span data-sort="size" class="${state.sortBy === 'size' ? 'sort-active' : ''}" style="text-align:right">Taille ${state.sortBy === 'size' ? (state.sortAsc ? '\u2191' : '\u2193') : ''}</span>
    <span data-sort="modified" class="${state.sortBy === 'modified' ? 'sort-active' : ''}">Modifi\u00e9 ${state.sortBy === 'modified' ? (state.sortAsc ? '\u2191' : '\u2193') : ''}</span>
  </div>`;
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
  container.innerHTML = html;

  loadThumbnails();
  setupSortHeader(container);
}

function setupSortHeader(container) {
  if (state.viewMode !== 'list') return;
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

export function renderEntries() {
  const container = document.getElementById('file-container');
  const emptyState = document.getElementById('empty-state');

  let entries = state.entries;

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    entries = entries.filter(e => e.name.toLowerCase().includes(q));
  }

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
    container.innerHTML = html;
    loadThumbnails();
    setupSortHeader(container);
  }

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
