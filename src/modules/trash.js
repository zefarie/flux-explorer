import { invoke } from './state.js';
import { escapeHtml, escapeAttr, formatSize, formatDate, showToast } from './utils.js';

let selectedTrash = new Set();

export function setupTrash() {
  document.getElementById('trash-close').addEventListener('click', hideTrash);
  document.getElementById('trash-restore').addEventListener('click', restoreSelected);
  document.getElementById('trash-purge').addEventListener('click', purgeSelected);
  document.getElementById('trash-empty').addEventListener('click', emptyAll);

  document.getElementById('trash-list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-trash-id]');
    if (!item) return;
    const id = item.dataset.trashId;
    if (selectedTrash.has(id)) {
      selectedTrash.delete(id);
      item.classList.remove('selected');
    } else {
      selectedTrash.add(id);
      item.classList.add('selected');
    }
    updateTrashButtons();
  });
}

export async function showTrash() {
  document.getElementById('trash-overlay').classList.remove('hidden');
  selectedTrash.clear();
  await refreshTrash();
}

function hideTrash() {
  document.getElementById('trash-overlay').classList.add('hidden');
  selectedTrash.clear();
}

async function refreshTrash() {
  const list = document.getElementById('trash-list');
  list.innerHTML = '<div class="spinner"></div>';

  try {
    const items = await invoke('list_trash');
    if (items.length === 0) {
      list.innerHTML = '<div class="trash-empty-state">Corbeille vide</div>';
      document.getElementById('trash-count').textContent = '0 \u00e9l\u00e9ment';
      updateTrashButtons();
      return;
    }

    list.innerHTML = items.map(item => `
      <div class="trash-item" data-trash-id="${escapeAttr(item.id)}">
        <div class="trash-name">${escapeHtml(item.name)}</div>
        <div class="trash-path">${escapeHtml(item.original_path)}</div>
        <div class="trash-meta">${formatSize(item.size)} - ${formatDate(item.deleted_at)}</div>
      </div>
    `).join('');
    document.getElementById('trash-count').textContent = `${items.length} \u00e9l\u00e9ment${items.length > 1 ? 's' : ''}`;
    updateTrashButtons();
  } catch (err) {
    list.innerHTML = `<p style="color:var(--red)">${escapeHtml(String(err))}</p>`;
  }
}

function updateTrashButtons() {
  const hasSelection = selectedTrash.size > 0;
  document.getElementById('trash-restore').disabled = !hasSelection;
  document.getElementById('trash-purge').disabled = !hasSelection;
}

async function restoreSelected() {
  if (selectedTrash.size === 0) return;
  try {
    await invoke('restore_trash_items', { ids: [...selectedTrash] });
    showToast(`${selectedTrash.size} \u00e9l\u00e9ment${selectedTrash.size > 1 ? 's' : ''} restaur\u00e9${selectedTrash.size > 1 ? 's' : ''}`, 'success');
    selectedTrash.clear();
    await refreshTrash();
  } catch (err) {
    showToast(String(err), 'error');
  }
}

async function purgeSelected() {
  if (selectedTrash.size === 0) return;
  try {
    await invoke('purge_trash_items', { ids: [...selectedTrash] });
    showToast(`${selectedTrash.size} \u00e9l\u00e9ment${selectedTrash.size > 1 ? 's' : ''} supprim\u00e9${selectedTrash.size > 1 ? 's' : ''} d\u00e9finitivement`, 'success');
    selectedTrash.clear();
    await refreshTrash();
  } catch (err) {
    showToast(String(err), 'error');
  }
}

async function emptyAll() {
  try {
    await invoke('empty_trash');
    showToast('Corbeille vid\u00e9e', 'success');
    selectedTrash.clear();
    await refreshTrash();
  } catch (err) {
    showToast(String(err), 'error');
  }
}
