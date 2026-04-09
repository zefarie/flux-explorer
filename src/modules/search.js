import { state, invoke } from './state.js';
import { showLoading, showToast } from './utils.js';
import { renderEntries } from './files.js';

let searchContent = false;

export function toggleSearchContent() {
  searchContent = !searchContent;
  const btn = document.getElementById('btn-search-content');
  if (btn) btn.classList.toggle('active', searchContent);
  if (state.searchQuery) performSearch();
}

export function isSearchContent() {
  return searchContent;
}

export async function performSearch() {
  if (!state.searchQuery) return;

  showLoading(true);
  try {
    const results = await invoke('search_files', {
      path: state.currentPath,
      query: state.searchQuery,
      showHidden: state.showHidden,
      maxDepth: 10,
      maxResults: 500,
      searchContent: searchContent,
    });
    state.entries = results;
    renderEntries();
    showToast(`${results.length} r\u00e9sultat${results.length > 1 ? 's' : ''}${results.length >= 500 ? ' (limite atteinte)' : ''}`, 'info');
  } catch (err) {
    showToast(err, 'error');
  }
  showLoading(false);
}
