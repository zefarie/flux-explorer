import { state, invoke } from './state.js';
import { showToast } from './utils.js';
import { updateSelection } from './files.js';
import { navigateTo } from './navigation.js';
import { clipboardCopy, clipboardCut, clipboardPaste } from './clipboard.js';
import { showRenameDialog, showNewFolderDialog, showNewFileDialog, showDeleteDialog } from './dialogs.js';
import { toggleBookmark, isBookmarked } from './bookmarks.js';
import { showProperties } from './properties.js';

export function setupContextMenu() {
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

    const hasTarget = state.contextTarget !== null;
    menu.querySelector('[data-action="open"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="copy"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="cut"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="paste"]').classList.toggle('hidden', state.clipboard.paths.length === 0);
    menu.querySelector('[data-action="rename"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="delete"]').classList.toggle('hidden', !hasTarget);

    // Bookmark: show only for directories, update label
    const targetEntry = hasTarget ? state.entries.find(en => en.path === state.contextTarget) : null;
    const isDir = targetEntry?.is_dir || false;
    const bookmarkItem = menu.querySelector('[data-action="toggle-bookmark"]');
    bookmarkItem.classList.toggle('hidden', !isDir);
    if (isDir && targetEntry) {
      const label = document.getElementById('ctx-bookmark-label');
      label.textContent = isBookmarked(targetEntry.path) ? 'Retirer des favoris' : 'Ajouter aux favoris';
    }
    menu.querySelector('[data-action="properties"]').classList.toggle('hidden', !hasTarget);

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
    case 'toggle-bookmark':
      if (state.contextTarget) toggleBookmark(state.contextTarget);
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
    case 'properties':
      if (state.contextTarget) showProperties(state.contextTarget);
      break;
  }
}
