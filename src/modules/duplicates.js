import { state, invoke } from './state.js';
import { escapeHtml, escapeAttr, formatSize, showToast } from './utils.js';
import { refresh } from './navigation.js';

let currentGroups = [];
const selectedToDelete = new Set();

export function setupDuplicates() {
  document.getElementById('dup-close').addEventListener('click', hideDuplicates);
  document.getElementById('dup-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'dup-overlay') hideDuplicates();
  });
  document.getElementById('dup-delete').addEventListener('click', deleteSelected);
  document.getElementById('dup-keep-first').addEventListener('click', keepFirstAuto);
}

export async function showDuplicates() {
  const overlay = document.getElementById('dup-overlay');
  const list = document.getElementById('dup-list');
  const status = document.getElementById('dup-status');
  const path = state.currentPath;

  selectedToDelete.clear();
  currentGroups = [];
  list.innerHTML = '<div class="spinner"></div><p style="text-align:center;color:var(--fg3);font-size:12px">Scan en cours...</p>';
  status.textContent = '';
  overlay.classList.remove('hidden');

  try {
    const groups = await invoke('find_duplicates', { path });
    currentGroups = groups;
    renderGroups();
  } catch (err) {
    list.innerHTML = `<p style="color:var(--red)">${escapeHtml(String(err))}</p>`;
  }
}

function renderGroups() {
  const list = document.getElementById('dup-list');
  const status = document.getElementById('dup-status');

  if (currentGroups.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--fg3);padding:24px">Aucun doublon trouv\u00e9</p>';
    status.textContent = '';
    return;
  }

  let totalWasted = 0;
  let totalFiles = 0;
  for (const g of currentGroups) {
    totalWasted += g.size * (g.paths.length - 1);
    totalFiles += g.paths.length;
  }

  status.textContent = `${currentGroups.length} groupe${currentGroups.length > 1 ? 's' : ''}, ${totalFiles} fichiers, ${formatSize(totalWasted)} r\u00e9cup\u00e9rables`;

  list.innerHTML = currentGroups.map((g, gi) => {
    const wasted = g.size * (g.paths.length - 1);
    return `
      <div class="dup-group">
        <div class="dup-group-header">
          <span class="dup-group-size">${formatSize(g.size)}</span>
          <span class="dup-group-meta">${g.paths.length} copies - ${formatSize(wasted)} r\u00e9cup\u00e9rables</span>
        </div>
        <div class="dup-group-paths">
          ${g.paths.map((p, pi) => `
            <label class="dup-path">
              <input type="checkbox" class="dup-check" data-group="${gi}" data-idx="${pi}" data-path="${escapeAttr(p)}">
              <span class="dup-path-text">${escapeHtml(p)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.dup-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedToDelete.add(cb.dataset.path);
      else selectedToDelete.delete(cb.dataset.path);
      updateDeleteButton();
    });
  });

  updateDeleteButton();
}

function updateDeleteButton() {
  const btn = document.getElementById('dup-delete');
  btn.disabled = selectedToDelete.size === 0;
  btn.textContent = selectedToDelete.size === 0
    ? 'Supprimer'
    : `Supprimer (${selectedToDelete.size})`;
}

function keepFirstAuto() {
  // Auto-select all but the first path in each group
  selectedToDelete.clear();
  document.querySelectorAll('.dup-check').forEach(cb => {
    const idx = parseInt(cb.dataset.idx, 10);
    if (idx > 0) {
      cb.checked = true;
      selectedToDelete.add(cb.dataset.path);
    } else {
      cb.checked = false;
    }
  });
  updateDeleteButton();
}

async function deleteSelected() {
  if (selectedToDelete.size === 0) return;
  const paths = [...selectedToDelete];
  if (!confirm(`Mettre ${paths.length} fichier${paths.length > 1 ? 's' : ''} \u00e0 la corbeille ?`)) return;

  try {
    await invoke('delete_items', { paths });
    showToast(`${paths.length} fichier${paths.length > 1 ? 's' : ''} supprim\u00e9${paths.length > 1 ? 's' : ''}`, 'success');
    // Remove deleted from current groups
    currentGroups = currentGroups
      .map(g => ({ ...g, paths: g.paths.filter(p => !selectedToDelete.has(p)) }))
      .filter(g => g.paths.length >= 2);
    selectedToDelete.clear();
    renderGroups();
    refresh();
  } catch (err) {
    showToast(String(err), 'error');
  }
}

function hideDuplicates() {
  document.getElementById('dup-overlay').classList.add('hidden');
}
