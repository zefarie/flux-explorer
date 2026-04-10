import { state, invoke } from './state.js';
import { showToast } from './utils.js';
import { updateSelection } from './files.js';
import { navigateTo } from './navigation.js';
import { clipboardCopy, clipboardCut, clipboardPaste } from './clipboard.js';
import { showRenameDialog, showNewFolderDialog, showNewFileDialog, showDeleteDialog } from './dialogs.js';
import { toggleBookmark, isBookmarked } from './bookmarks.js';
import { showProperties } from './properties.js';
import { extractHere, createArchive, isArchive } from './archives.js';
import { showBatchRename } from './batch-rename.js';
import { showOpenWith } from './open-with.js';
import { showHash } from './hash.js';
import { startInlineRename } from './inline-rename.js';

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

    // Open with: only for files (not dirs)
    menu.querySelector('[data-action="open-with"]').classList.toggle('hidden', !hasTarget || isDir);

    // Hash: only for files
    menu.querySelector('[data-action="hash"]').classList.toggle('hidden', !hasTarget || isDir);

    // Extract here: only for archive files
    const archiveExts = ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar'];
    const isArchiveFile = hasTarget && !isDir && targetEntry && archiveExts.some(e => targetEntry.name.toLowerCase().endsWith('.' + e));
    menu.querySelector('[data-action="extract-here"]').classList.toggle('hidden', !isArchiveFile);

    // Compress: hide if no selection or single dir without other selection
    menu.querySelector('[data-action="compress-zip"]').classList.toggle('hidden', !hasTarget);
    menu.querySelector('[data-action="compress-targz"]').classList.toggle('hidden', !hasTarget);

    // Batch rename: only when multiple items selected
    menu.querySelector('[data-action="batch-rename"]').classList.toggle('hidden', state.selected.size < 2);

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
      if (state.contextTarget) {
        // Defer to next tick so the menu has time to close
        const path = state.contextTarget;
        setTimeout(() => {
          if (!startInlineRename(path)) showRenameDialog(path);
        }, 0);
      }
      break;
    case 'delete':
      showDeleteDialog();
      break;
    case 'properties':
      if (state.contextTarget) showProperties(state.contextTarget);
      break;
    case 'open-with':
      if (state.contextTarget) showOpenWith(state.contextTarget);
      break;
    case 'extract-here':
      if (state.contextTarget) extractHere(state.contextTarget);
      break;
    case 'compress-zip':
      if (state.selected.size > 0) createArchive([...state.selected], 'zip');
      else if (state.contextTarget) createArchive([state.contextTarget], 'zip');
      break;
    case 'compress-targz':
      if (state.selected.size > 0) createArchive([...state.selected], 'tar.gz');
      else if (state.contextTarget) createArchive([state.contextTarget], 'tar.gz');
      break;
    case 'batch-rename':
      if (state.selected.size >= 2) showBatchRename([...state.selected]);
      break;
    case 'hash':
      if (state.contextTarget) showHash(state.contextTarget);
      break;
  }
}
