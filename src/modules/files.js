import { state, invoke, savePrefs } from './state.js';
import { escapeHtml, escapeAttr, formatSize, formatDate } from './utils.js';
import { getFileIcon } from './icons.js';
import { getThumbType, loadThumbnails } from './thumbnails.js';
import { updateStatusBar } from './statusbar.js';
import { navigateTo } from './navigation.js';

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
    }
    return state.sortAsc ? cmp : -cmp;
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
      <span data-sort="name" class="${state.sortBy === 'name' ? 'sort-active' : ''}">Nom ${state.sortBy === 'name' ? (state.sortAsc ? '\u2191' : '\u2193') : ''}</span>
      <span data-sort="size" class="${state.sortBy === 'size' ? 'sort-active' : ''}" style="text-align:right">Taille ${state.sortBy === 'size' ? (state.sortAsc ? '\u2191' : '\u2193') : ''}</span>
      <span data-sort="modified" class="${state.sortBy === 'modified' ? 'sort-active' : ''}">Modifie ${state.sortBy === 'modified' ? (state.sortAsc ? '\u2191' : '\u2193') : ''}</span>
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
        <div class="file-size">${entry.is_dir ? '-' : formatSize(entry.size)}</div>
        <div class="file-date">${formatDate(entry.modified)}</div>
      </div>`;
    }
  });

  container.innerHTML = html;
  updateStatusBar(entries.length);
  loadThumbnails();

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
