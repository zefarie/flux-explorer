import { state, invoke } from './state.js';
import { showToast } from './utils.js';
import { refresh } from './navigation.js';

export function setupDialogs() {
  document.getElementById('rename-cancel').addEventListener('click', () => hideDialog('rename'));
  document.getElementById('rename-confirm').addEventListener('click', confirmRename);
  document.getElementById('rename-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') hideDialog('rename');
  });

  document.getElementById('newfolder-cancel').addEventListener('click', () => hideDialog('newfolder'));
  document.getElementById('newfolder-confirm').addEventListener('click', confirmNewFolder);
  document.getElementById('newfolder-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmNewFolder();
    if (e.key === 'Escape') hideDialog('newfolder');
  });

  document.getElementById('newfile-cancel').addEventListener('click', () => hideDialog('newfile'));
  document.getElementById('newfile-confirm').addEventListener('click', confirmNewFile);
  document.getElementById('newfile-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmNewFile();
    if (e.key === 'Escape') hideDialog('newfile');
  });

  document.getElementById('delete-cancel').addEventListener('click', () => hideDialog('delete'));
  document.getElementById('delete-confirm').addEventListener('click', confirmDelete);
}

export function showRenameDialog(path) {
  const entry = state.entries.find(e => e.path === path);
  if (!entry) return;

  const input = document.getElementById('rename-input');
  input.value = entry.name;
  input.dataset.path = path;

  document.getElementById('rename-overlay').classList.remove('hidden');

  requestAnimationFrame(() => {
    input.focus();
    if (!entry.is_dir && entry.name.includes('.')) {
      input.setSelectionRange(0, entry.name.lastIndexOf('.'));
    } else {
      input.select();
    }
  });
}

async function confirmRename() {
  const input = document.getElementById('rename-input');
  const newName = input.value.trim();
  const path = input.dataset.path;
  if (!newName || !path) return;

  try {
    await invoke('rename_item', { path, newName });
    hideDialog('rename');
    await refresh();
  } catch (err) {
    showToast(err, 'error');
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = '', 1500);
  }
}

export function showNewFolderDialog() {
  const input = document.getElementById('newfolder-input');
  input.value = '';
  document.getElementById('newfolder-overlay').classList.remove('hidden');
  requestAnimationFrame(() => input.focus());
}

async function confirmNewFolder() {
  const input = document.getElementById('newfolder-input');
  const name = input.value.trim();
  if (!name) return;

  try {
    await invoke('create_folder', { path: state.currentPath, name });
    hideDialog('newfolder');
    await refresh();
  } catch (err) {
    showToast(err, 'error');
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = '', 1500);
  }
}

export function showNewFileDialog() {
  const input = document.getElementById('newfile-input');
  input.value = '';
  document.getElementById('newfile-overlay').classList.remove('hidden');
  requestAnimationFrame(() => input.focus());
}

async function confirmNewFile() {
  const input = document.getElementById('newfile-input');
  const name = input.value.trim();
  if (!name) return;

  try {
    await invoke('create_file', { path: state.currentPath, name });
    hideDialog('newfile');
    await refresh();
  } catch (err) {
    showToast(err, 'error');
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = '', 1500);
  }
}

export function showDeleteDialog() {
  const paths = [...state.selected];
  if (paths.length === 0) return;

  const names = paths.map(p => {
    const entry = state.entries.find(e => e.path === p);
    return entry ? entry.name : p.split('/').pop();
  });

  const msg = paths.length === 1
    ? `Supprimer "${names[0]}" ?`
    : `Supprimer ${paths.length} elements ?`;

  document.getElementById('delete-message').textContent = msg;
  document.getElementById('delete-overlay').classList.remove('hidden');
  document.getElementById('delete-confirm').focus();
}

async function confirmDelete() {
  const paths = [...state.selected];
  if (paths.length === 0) return;

  try {
    await invoke('delete_items', { paths });
    hideDialog('delete');
    showToast(`${paths.length} element${paths.length > 1 ? 's' : ''} supprime${paths.length > 1 ? 's' : ''}`, 'success');
    await refresh();
  } catch (err) {
    showToast(err, 'error');
    hideDialog('delete');
  }
}

function hideDialog(name) {
  document.getElementById(`${name}-overlay`).classList.add('hidden');
}
