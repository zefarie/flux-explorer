import { state, invoke } from './state.js';
import { escapeHtml, escapeAttr, showToast } from './utils.js';
import { refresh } from './navigation.js';

let currentPaths = [];
let currentPreview = [];

export function setupBatchRename() {
  const overlay = document.getElementById('batch-rename-overlay');
  const cancelBtn = document.getElementById('batch-rename-cancel');
  const applyBtn = document.getElementById('batch-rename-apply');

  cancelBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  applyBtn.addEventListener('click', applyBatchRename);

  // Update preview on input change
  ['batch-pattern', 'batch-find', 'batch-replace', 'batch-regex', 'batch-case', 'batch-start'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input', updatePreview);
    el?.addEventListener('change', updatePreview);
  });
}

export function showBatchRename(paths) {
  if (paths.length === 0) return;
  currentPaths = paths;

  document.getElementById('batch-pattern').value = '';
  document.getElementById('batch-find').value = '';
  document.getElementById('batch-replace').value = '';
  document.getElementById('batch-regex').checked = false;
  document.getElementById('batch-case').value = 'none';
  document.getElementById('batch-start').value = '1';

  document.getElementById('batch-rename-overlay').classList.remove('hidden');
  updatePreview();
}

async function updatePreview() {
  const pattern = document.getElementById('batch-pattern').value;
  const find = document.getElementById('batch-find').value;
  const replace = document.getElementById('batch-replace').value;
  const useRegex = document.getElementById('batch-regex').checked;
  const caseMode = document.getElementById('batch-case').value;
  const startIndex = parseInt(document.getElementById('batch-start').value) || 1;

  try {
    const previews = await invoke('batch_rename_preview', {
      paths: currentPaths,
      pattern,
      find,
      replace,
      useRegex,
      caseMode,
      startIndex,
    });

    currentPreview = previews;
    const list = document.getElementById('batch-preview-list');
    list.innerHTML = previews.slice(0, 100).map(p => {
      const old = p.old_path.split('/').pop();
      const conflictClass = p.conflict ? ' conflict' : '';
      return `<div class="batch-preview-row${conflictClass}">
        <span class="batch-old">${escapeHtml(old)}</span>
        <span class="batch-arrow">\u2192</span>
        <span class="batch-new">${escapeHtml(p.new_name)}</span>
        ${p.conflict ? '<span class="batch-conflict">conflit</span>' : ''}
      </div>`;
    }).join('');

    const conflictCount = previews.filter(p => p.conflict).length;
    document.getElementById('batch-status').textContent =
      `${previews.length} fichier${previews.length > 1 ? 's' : ''}` +
      (conflictCount > 0 ? ` - ${conflictCount} conflit${conflictCount > 1 ? 's' : ''}` : '');
  } catch (err) {
    showToast(String(err), 'error');
  }
}

async function applyBatchRename() {
  const renames = currentPreview
    .filter(p => !p.conflict)
    .map(p => [p.old_path, p.new_name]);

  if (renames.length === 0) {
    showToast('Aucun renommage applicable', 'error');
    return;
  }

  try {
    const errors = await invoke('batch_rename_apply', { renames });
    document.getElementById('batch-rename-overlay').classList.add('hidden');
    if (errors && errors.length > 0) {
      showToast(`${errors.length} erreur${errors.length > 1 ? 's' : ''}`, 'error');
    } else {
      showToast(`${renames.length} fichier${renames.length > 1 ? 's' : ''} renomm\u00e9${renames.length > 1 ? 's' : ''}`, 'success');
    }
    await refresh();
  } catch (err) {
    showToast(String(err), 'error');
  }
}
