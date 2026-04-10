import { invoke } from './state.js';
import { escapeHtml, escapeAttr, formatSize, showToast } from './utils.js';
import { navigateTo } from './navigation.js';

let refreshTimer = null;

export async function loadMounts() {
  const container = document.getElementById('mounts');
  if (!container) return;

  try {
    const mounts = await invoke('get_mount_points');
    if (mounts.length === 0) {
      container.innerHTML = '';
      return;
    }

    const diskSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';
    const usbSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="7" r="1"/><circle cx="4" cy="20" r="1"/><path d="M4.7 19.3 19 5"/><path d="m21 3-3 1 2 2z"/><path d="M9.26 7.68 5 12l2 5"/><path d="m10 14 5 2"/></svg>';
    const ejectSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4 4 14h16z"/><path d="M4 18h16"/></svg>';

    container.innerHTML = mounts.map(m => {
      const pct = m.total > 0 ? Math.round((m.used / m.total) * 100) : 0;
      const usageClass = pct >= 90 ? 'usage-crit' : pct >= 75 ? 'usage-high' : pct >= 50 ? 'usage-mid' : 'usage-low';
      const sizeText = m.total > 0 ? `${formatSize(m.used)} / ${formatSize(m.total)} (${pct}%)` : m.fs_type;

      return `<div class="mount-item">
        <div class="sidebar-item" data-path="${escapeAttr(m.path)}" data-mount="${escapeAttr(m.path)}">
          ${m.is_removable ? usbSvg : diskSvg}
          <span class="mount-name">${escapeHtml(m.name)}</span>
          ${m.is_removable ? `<span class="mount-eject" data-eject="${escapeAttr(m.path)}" title="Demonter">${ejectSvg}</span>` : ''}
        </div>
        <div class="mount-info">
          <span>${sizeText}</span>
          ${m.total > 0 ? `<div class="disk-bar"><div class="disk-bar-fill ${usageClass}" style="width:${pct}%"></div></div>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '';
  }
}

export function setupMounts() {
  const container = document.getElementById('mounts');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const ejectBtn = e.target.closest('[data-eject]');
    if (ejectBtn) {
      e.stopPropagation();
      const path = ejectBtn.dataset.eject;
      try {
        await invoke('unmount_path', { path });
        showToast('D\u00e9mont\u00e9', 'success');
        await loadMounts();
      } catch (err) {
        showToast(String(err), 'error');
      }
      return;
    }

    const item = e.target.closest('[data-mount]');
    if (item) navigateTo(item.dataset.mount);
  });

  // Refresh mounts every 5s to detect plug/unplug
  refreshTimer = setInterval(loadMounts, 5000);
}

export function cleanupMounts() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
