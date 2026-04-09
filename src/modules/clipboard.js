import { state, invoke } from './state.js';
import { showToast } from './utils.js';
import { renderEntries } from './files.js';
import { refresh } from './navigation.js';

export function clipboardCopy() {
  if (state.selected.size === 0) return;
  state.clipboard = { paths: [...state.selected], action: 'copy' };
  showToast(`${state.clipboard.paths.length} element${state.clipboard.paths.length > 1 ? 's' : ''} copie${state.clipboard.paths.length > 1 ? 's' : ''}`, 'info');
  renderEntries();
}

export function clipboardCut() {
  if (state.selected.size === 0) return;
  state.clipboard = { paths: [...state.selected], action: 'cut' };
  showToast(`${state.clipboard.paths.length} element${state.clipboard.paths.length > 1 ? 's' : ''} coupe${state.clipboard.paths.length > 1 ? 's' : ''}`, 'info');
  renderEntries();
}

export async function clipboardPaste() {
  if (state.clipboard.paths.length === 0 || !state.clipboard.action) return;

  const dest = state.currentPath;
  const sources = state.clipboard.paths;
  const action = state.clipboard.action;

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
