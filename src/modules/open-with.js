import { invoke } from './state.js';
import { escapeHtml, escapeAttr, showToast } from './utils.js';

let currentFile = null;

export function setupOpenWith() {
  const overlay = document.getElementById('open-with-overlay');
  document.getElementById('open-with-cancel').addEventListener('click', () => overlay.classList.add('hidden'));

  document.getElementById('open-with-list').addEventListener('click', async (e) => {
    const item = e.target.closest('[data-exec]');
    if (!item || !currentFile) return;
    const exec = item.dataset.exec;
    try {
      await invoke('open_with', { filePath: currentFile, exec });
      overlay.classList.add('hidden');
    } catch (err) {
      showToast(String(err), 'error');
    }
  });

  // Filter on search input
  document.getElementById('open-with-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#open-with-list .open-with-item').forEach(el => {
      const name = el.dataset.name?.toLowerCase() || '';
      el.style.display = name.includes(q) ? '' : 'none';
    });
  });
}

export async function showOpenWith(filePath) {
  currentFile = filePath;
  document.getElementById('open-with-search').value = '';
  document.getElementById('open-with-overlay').classList.remove('hidden');

  const list = document.getElementById('open-with-list');
  list.innerHTML = '<div class="spinner"></div>';

  try {
    const apps = await invoke('list_applications');
    list.innerHTML = apps.map(app => `
      <div class="open-with-item" data-exec="${escapeAttr(app.exec)}" data-name="${escapeAttr(app.name)}">
        <div class="open-with-name">${escapeHtml(app.name)}</div>
        <div class="open-with-exec">${escapeHtml(app.exec)}</div>
      </div>
    `).join('');

    setTimeout(() => document.getElementById('open-with-search').focus(), 50);
  } catch (err) {
    list.innerHTML = `<p style="color:var(--red)">${escapeHtml(String(err))}</p>`;
  }
}
