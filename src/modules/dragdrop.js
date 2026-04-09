import { state, invoke } from './state.js';
import { showToast } from './utils.js';
import { updateSelection } from './files.js';
import { refresh } from './navigation.js';

export function setupDragDrop() {
  const container = document.getElementById('file-container');
  const fileArea = document.getElementById('file-area');
  let dragPaths = [];

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;

    const path = item.dataset.path;

    if (!state.selected.has(path)) {
      state.selected.clear();
      state.selected.add(path);
      updateSelection();
    }

    dragPaths = [...state.selected];
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', dragPaths.join('\n'));

    requestAnimationFrame(() => {
      document.querySelectorAll('.file-item').forEach(el => {
        if (state.selected.has(el.dataset.path)) {
          el.classList.add('dragging');
        }
      });
    });
  });

  container.addEventListener('dragend', () => {
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    fileArea.classList.remove('drag-over-area');
    dragPaths = [];
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    const item = e.target.closest('.file-item');

    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    if (item && item.dataset.isDir === 'true' && !dragPaths.includes(item.dataset.path)) {
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
      item.classList.add('drag-over');
    } else {
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    }
  });

  container.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.file-item');
    if (item) item.classList.remove('drag-over');
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    fileArea.classList.remove('drag-over-area');

    if (dragPaths.length === 0) return;

    const item = e.target.closest('.file-item');
    let dest = state.currentPath;

    if (item && item.dataset.isDir === 'true' && !dragPaths.includes(item.dataset.path)) {
      dest = item.dataset.path;
    }

    if (dragPaths.some(p => p === dest)) return;

    try {
      if (e.ctrlKey) {
        await invoke('copy_items', { sources: dragPaths, destination: dest });
        showToast(`${dragPaths.length} element${dragPaths.length > 1 ? 's' : ''} copie${dragPaths.length > 1 ? 's' : ''}`, 'success');
      } else {
        await invoke('move_items', { sources: dragPaths, destination: dest });
        showToast(`${dragPaths.length} element${dragPaths.length > 1 ? 's' : ''} deplace${dragPaths.length > 1 ? 's' : ''}`, 'success');
      }
      await refresh();
    } catch (err) {
      showToast(err, 'error');
    }

    dragPaths = [];
  });

  fileArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dragPaths.length > 0 && !e.target.closest('.file-item')) {
      fileArea.classList.add('drag-over-area');
    }
  });

  fileArea.addEventListener('dragleave', (e) => {
    if (!fileArea.contains(e.relatedTarget)) {
      fileArea.classList.remove('drag-over-area');
    }
  });
}
