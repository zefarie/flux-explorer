import { state, invoke } from './state.js';
import { showToast } from './utils.js';
import { renderEntries } from './files.js';
import { refresh } from './navigation.js';

export function clipboardCopy() {
  if (state.selected.size === 0) return;
  state.clipboard = { paths: [...state.selected], action: 'copy' };
  showToast(`${state.clipboard.paths.length} \u00e9l\u00e9ment${state.clipboard.paths.length > 1 ? 's' : ''} copi\u00e9${state.clipboard.paths.length > 1 ? 's' : ''}`, 'info');
  renderEntries();
}

export function clipboardCut() {
  if (state.selected.size === 0) return;
  state.clipboard = { paths: [...state.selected], action: 'cut' };
  showToast(`${state.clipboard.paths.length} \u00e9l\u00e9ment${state.clipboard.paths.length > 1 ? 's' : ''} coup\u00e9${state.clipboard.paths.length > 1 ? 's' : ''}`, 'info');
  renderEntries();
}

export async function clipboardPaste() {
  if (state.clipboard.paths.length === 0 || !state.clipboard.action) return;

  const dest = state.currentPath;
  const sources = state.clipboard.paths;
  const action = state.clipboard.action;

  // Cut in same dir: convert to copy (creates duplicates with suffix)
  const sameDir = action === 'cut' && sources.every(s => {
    const parent = s.substring(0, s.lastIndexOf('/')) || '/';
    return parent === dest;
  });

  try {
    if (action === 'copy' || sameDir) {
      await invoke('copy_items', { sources, destination: dest });
      showToast(`${sources.length} \u00e9l\u00e9ment${sources.length > 1 ? 's' : ''} coll\u00e9${sources.length > 1 ? 's' : ''}`, 'success');
      if (sameDir) state.clipboard = { paths: [], action: null };
    } else {
      await invoke('move_items', { sources, destination: dest });
      showToast(`${sources.length} \u00e9l\u00e9ment${sources.length > 1 ? 's' : ''} d\u00e9plac\u00e9${sources.length > 1 ? 's' : ''}`, 'success');
      state.clipboard = { paths: [], action: null };
    }
    await refresh();
  } catch (err) {
    showToast(err, 'error');
  }
}
