export function formatSize(bytes) {
  if (bytes === 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

// Cache today's/yesterday's calendar keys, recomputed at most once a minute,
// so rendering large directories doesn't build 4 Date objects per row
let dayCache = { at: 0, todayKey: 0, yesterdayKey: 0 };

function dateKey(d) {
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

function refreshDayCache() {
  const now = Date.now();
  if (now - dayCache.at < 60000) return;
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  dayCache = { at: now, todayKey: dateKey(today), yesterdayKey: dateKey(yesterday) };
}

export function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  refreshDayCache();

  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const key = dateKey(date);

  if (key === dayCache.todayKey) return `Aujourd'hui ${time}`;
  if (key === dayCache.yesterdayKey) return `Hier ${time}`;

  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + time;
}

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(str) {
  return String(str).replace(HTML_ESCAPE_RE, (c) => HTML_ESCAPES[c]);
}

export function escapeAttr(str) {
  return escapeHtml(str);
}

export function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(String(message))}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}
