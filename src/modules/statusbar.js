import { state } from './state.js';
import { formatSize } from './utils.js';

export function updateStatusBar(count) {
  const total = count ?? state.entries.length;
  document.getElementById('status-count').textContent = `${total} \u00e9l\u00e9ment${total !== 1 ? 's' : ''}`;

  const selCount = state.selected.size;
  const selEl = document.getElementById('status-selected');
  if (selCount > 0) {
    const selPaths = [...state.selected];
    const totalSize = selPaths.reduce((acc, path) => {
      const entry = state.entries.find(e => e.path === path);
      return acc + (entry?.size || 0);
    }, 0);
    let selText = `${selCount} s\u00e9lectionn\u00e9${selCount > 1 ? 's' : ''}`;
    if (totalSize > 0) selText += ` - ${formatSize(totalSize)}`;
    if (selCount === 1) {
      const entry = state.entries.find(e => e.path === selPaths[0]);
      if (entry?.permissions) selText += ` - ${entry.permissions}`;
    }
    selEl.textContent = selText;
    selEl.classList.remove('hidden');
  } else {
    selEl.classList.add('hidden');
  }

  document.getElementById('status-path').textContent = state.currentPath;
}
