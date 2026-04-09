import { state, invoke } from './state.js';
import { escapeHtml, escapeAttr, formatSize } from './utils.js';
import { navigateTo } from './navigation.js';

const sidebarIcons = {
  home: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  desktop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  documents: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  downloads: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  images: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  music: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  videos: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
  gaming: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><circle cx="15" cy="10" r="1" fill="currentColor"/><circle cx="18" cy="13" r="1" fill="currentColor"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>',
};

export async function loadQuickAccess() {
  const items = await invoke('get_quick_access');
  const container = document.getElementById('quick-access');

  container.innerHTML = items.map(item => `
    <div class="sidebar-item" data-path="${escapeAttr(item.path)}">
      ${sidebarIcons[item.icon] || sidebarIcons.documents}
      <span>${escapeHtml(item.name)}</span>
    </div>
  `).join('');

  container.addEventListener('click', (e) => {
    const item = e.target.closest('.sidebar-item');
    if (item) navigateTo(item.dataset.path);
  });

  document.querySelector('#sidebar .sidebar-item[data-path="/"]')?.addEventListener('click', () => {
    navigateTo('/');
  });
}

export function updateSidebar() {
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('active', item.dataset.path === state.currentPath);
  });
  loadDiskInfo();
}

async function loadDiskInfo() {
  const container = document.getElementById('disk-info');
  if (!container) return;
  try {
    const info = await invoke('get_disk_info', { path: '/' });
    const pct = Math.round((info.used / info.total) * 100);
    const usageClass = pct >= 90 ? 'usage-crit' : pct >= 75 ? 'usage-high' : pct >= 50 ? 'usage-mid' : 'usage-low';
    container.innerHTML = `
      <span>${formatSize(info.used)} / ${formatSize(info.total)} (${pct}%)</span>
      <div class="disk-bar">
        <div class="disk-bar-fill ${usageClass}" style="width: ${pct}%"></div>
      </div>
    `;
  } catch (_) {
    container.innerHTML = '';
  }
}
