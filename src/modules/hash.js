import { invoke } from './state.js';
import { escapeHtml, showToast } from './utils.js';

export function setupHash() {
  document.getElementById('hash-close').addEventListener('click', hideHash);
  document.getElementById('hash-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'hash-overlay') hideHash();
  });
}

export async function showHash(path) {
  const overlay = document.getElementById('hash-overlay');
  const content = document.getElementById('hash-content');
  const title = document.getElementById('hash-title');

  const name = path.split('/').pop();
  title.textContent = `Empreintes - ${name}`;
  content.innerHTML = '<div class="spinner"></div><p style="text-align:center;color:var(--fg3);font-size:12px">Calcul en cours...</p>';
  overlay.classList.remove('hidden');

  try {
    const hashes = await invoke('compute_hashes', { path });
    content.innerHTML = `
      <div class="hash-row">
        <div class="hash-label">MD5</div>
        <div class="hash-value-wrap">
          <code class="hash-value">${escapeHtml(hashes.md5)}</code>
          <button class="hash-copy" data-hash="${escapeHtml(hashes.md5)}" title="Copier">Copier</button>
        </div>
      </div>
      <div class="hash-row">
        <div class="hash-label">SHA1</div>
        <div class="hash-value-wrap">
          <code class="hash-value">${escapeHtml(hashes.sha1)}</code>
          <button class="hash-copy" data-hash="${escapeHtml(hashes.sha1)}" title="Copier">Copier</button>
        </div>
      </div>
      <div class="hash-row">
        <div class="hash-label">SHA256</div>
        <div class="hash-value-wrap">
          <code class="hash-value">${escapeHtml(hashes.sha256)}</code>
          <button class="hash-copy" data-hash="${escapeHtml(hashes.sha256)}" title="Copier">Copier</button>
        </div>
      </div>
    `;
    content.querySelectorAll('.hash-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.hash);
          showToast('Empreinte copi\u00e9e', 'success');
        } catch (_) {}
      });
    });
  } catch (err) {
    content.innerHTML = `<p style="color:var(--red)">${escapeHtml(String(err))}</p>`;
  }
}

function hideHash() {
  document.getElementById('hash-overlay').classList.add('hidden');
}
