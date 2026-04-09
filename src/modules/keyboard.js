import { state } from './state.js';
import { invoke } from './state.js';
import { navigateTo, goBack, goForward, goUp, refresh, showPathInput } from './navigation.js';
import { renderEntries, sortEntries, updateSelection, setViewMode, toggleHidden } from './files.js';
import { clipboardCopy, clipboardCut, clipboardPaste } from './clipboard.js';
import { showRenameDialog, showNewFolderDialog, showDeleteDialog } from './dialogs.js';
import { openPreview, closePreview } from './preview.js';
import { performSearch } from './search.js';
import { createTab, closeTab, getActiveTab, getTabCount } from './tabs.js';

export function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    // Ctrl+T -- New tab
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      createTab();
      return;
    }

    // Ctrl+W -- Close tab
    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      const tab = getActiveTab();
      if (tab && getTabCount() > 1) closeTab(tab.id);
      return;
    }

    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      showPathInput();
      return;
    }

    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      document.getElementById('search-input').focus();
      return;
    }

    if (e.ctrlKey && e.key === 'h') {
      e.preventDefault();
      toggleHidden();
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      showNewFolderDialog();
      return;
    }

    if (e.key === 'F2' && state.selected.size === 1) {
      e.preventDefault();
      showRenameDialog([...state.selected][0]);
      return;
    }

    if (e.key === 'F5') {
      e.preventDefault();
      refresh();
      return;
    }

    if (e.key === 'Delete' && state.selected.size > 0) {
      e.preventDefault();
      showDeleteDialog();
      return;
    }

    if (e.key === 'Enter' && state.selected.size === 1) {
      e.preventDefault();
      const path = [...state.selected][0];
      const entry = state.entries.find(e => e.path === path);
      if (entry?.is_dir) navigateTo(entry.path);
      else invoke('open_file', { path });
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      goUp();
      return;
    }

    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      goBack();
      return;
    }

    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      goForward();
      return;
    }

    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      goUp();
      return;
    }

    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      clipboardCopy();
      return;
    }

    if (e.ctrlKey && e.key === 'x') {
      e.preventDefault();
      clipboardCut();
      return;
    }

    if (e.ctrlKey && e.key === 'v') {
      e.preventDefault();
      clipboardPaste();
      return;
    }

    // Arrow keys -- navigate between items
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      navigateByArrow(e.key, e.shiftKey);
      return;
    }

    // Home / End
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const sorted = sortEntries(state.entries);
      if (sorted.length === 0) return;
      const target = e.key === 'Home' ? sorted[0] : sorted[sorted.length - 1];
      state.selected.clear();
      state.selected.add(target.path);
      state.lastSelected = e.key === 'Home' ? 0 : sorted.length - 1;
      updateSelection();
      scrollToSelected();
      return;
    }

    if (e.key === ' ' && state.selected.size === 1) {
      e.preventDefault();
      const path = [...state.selected][0];
      const entry = state.entries.find(e => e.path === path);
      if (entry && !entry.is_dir) openPreview(entry);
      return;
    }

    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      state.entries.forEach(e => state.selected.add(e.path));
      updateSelection();
      return;
    }

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

function navigateByArrow(key, shiftKey) {
  const sorted = sortEntries(state.entries);
  if (sorted.length === 0) return;

  let currentIndex = state.lastSelected ?? -1;

  if (currentIndex < 0 || currentIndex >= sorted.length) {
    currentIndex = 0;
    state.selected.clear();
    state.selected.add(sorted[0].path);
    state.lastSelected = 0;
    updateSelection();
    scrollToSelected();
    return;
  }

  let step = 0;
  if (state.viewMode === 'grid') {
    const cols = getGridColumns();
    switch (key) {
      case 'ArrowRight': step = 1; break;
      case 'ArrowLeft':  step = -1; break;
      case 'ArrowDown':  step = cols; break;
      case 'ArrowUp':    step = -cols; break;
    }
  } else {
    switch (key) {
      case 'ArrowDown':  step = 1; break;
      case 'ArrowUp':    step = -1; break;
      case 'ArrowRight': step = 1; break;
      case 'ArrowLeft':  step = -1; break;
    }
  }

  const newIndex = Math.max(0, Math.min(sorted.length - 1, currentIndex + step));
  if (newIndex === currentIndex) return;

  if (shiftKey) {
    const start = Math.min(state.lastSelected, newIndex);
    const end = Math.max(state.lastSelected, newIndex);
    for (let i = start; i <= end; i++) {
      state.selected.add(sorted[i].path);
    }
  } else {
    state.selected.clear();
    state.selected.add(sorted[newIndex].path);
  }

  state.lastSelected = newIndex;
  updateSelection();
  scrollToSelected();
}

function getGridColumns() {
  const container = document.getElementById('file-container');
  if (!container || !container.children.length) return 1;
  const first = container.querySelector('.file-item');
  if (!first) return 1;
  const containerWidth = container.clientWidth;
  const itemWidth = first.offsetWidth + 8;
  return Math.max(1, Math.floor(containerWidth / itemWidth));
}

function scrollToSelected() {
  const selected = document.querySelector('.file-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export function setupToolbarSearch() {
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
