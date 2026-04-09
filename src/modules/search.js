import { state, invoke } from './state.js';
import { showLoading, showToast } from './utils.js';
import { renderEntries } from './files.js';

export async function performSearch() {
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
