import { state, invoke } from './state.js';
import { escapeHtml, escapeAttr, formatSize, showToast } from './utils.js';
import { navigateTo } from './navigation.js';

let currentRoot = null;
let stack = [];

export function setupDiskUsage() {
  document.getElementById('du-close').addEventListener('click', hideDiskUsage);
  document.getElementById('du-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'du-overlay') hideDiskUsage();
  });
  document.getElementById('du-up').addEventListener('click', goUp);
}

export async function showDiskUsage() {
  const overlay = document.getElementById('du-overlay');
  const list = document.getElementById('du-list');
  const path = state.currentPath;

  stack = [];
  list.innerHTML = '<div class="spinner"></div><p style="text-align:center;color:var(--fg3);font-size:12px">Analyse en cours...</p>';
  document.getElementById('du-path').textContent = path;
  document.getElementById('du-total').textContent = '';
  overlay.classList.remove('hidden');

  try {
    const root = await invoke('scan_disk_usage', { path, maxDepth: 6 });
    currentRoot = root;
    render(root);
  } catch (err) {
    list.innerHTML = `<p style="color:var(--red)">${escapeHtml(String(err))}</p>`;
  }
}

function render(node) {
  const list = document.getElementById('du-list');
  document.getElementById('du-path').textContent = node.path;
  document.getElementById('du-total').textContent = formatSize(node.size);
  document.getElementById('du-up').disabled = stack.length === 0;

  if (!node.children || node.children.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--fg3);padding:24px">Dossier vide</p>';
    return;
  }

  const total = node.size || 1;
  list.innerHTML = node.children.map(child => {
    const pct = ((child.size / total) * 100).toFixed(1);
    const icon = child.is_dir ? 'folder' : 'file';
    return `
      <div class="du-row${child.is_dir ? ' du-dir' : ''}" data-path="${escapeAttr(child.path)}" data-is-dir="${child.is_dir}">
        <div class="du-row-icon">
          ${child.is_dir
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>'}
        </div>
        <div class="du-row-name">${escapeHtml(child.name)}</div>
        <div class="du-row-bar"><div class="du-row-bar-fill" style="width:${pct}%"></div></div>
        <div class="du-row-pct">${pct}%</div>
        <div class="du-row-size">${formatSize(child.size)}</div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.du-row').forEach(row => {
    row.addEventListener('dblclick', () => {
      const isDir = row.dataset.isDir === 'true';
      if (!isDir) return;
      const path = row.dataset.path;
      const child = node.children.find(c => c.path === path);
      if (child && child.children && child.children.length > 0) {
        stack.push(node);
        render(child);
      }
    });
  });
}

function goUp() {
  if (stack.length === 0) return;
  const prev = stack.pop();
  render(prev);
}

function hideDiskUsage() {
  document.getElementById('du-overlay').classList.add('hidden');
}
