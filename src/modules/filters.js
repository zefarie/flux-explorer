import { state } from './state.js';
import { renderEntries } from './files.js';

// Filter definitions: each maps to a predicate over an entry
const TYPE_GROUPS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif'],
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp'],
  audio: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma'],
  doc: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'ods', 'xls', 'xlsx', 'odp', 'ppt', 'pptx', 'epub'],
  code: ['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'sh', 'lua', 'kt', 'swift', 'sql', 'html', 'css', 'json', 'yaml', 'yml', 'toml', 'xml'],
  archive: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar'],
};

state.filters = {
  type: 'all',
  size: 'all',
  date: 'all',
};

export function setupFilters() {
  document.getElementById('filter-type').addEventListener('change', (e) => {
    state.filters.type = e.target.value;
    renderEntries();
  });
  document.getElementById('filter-size').addEventListener('change', (e) => {
    state.filters.size = e.target.value;
    renderEntries();
  });
  document.getElementById('filter-date').addEventListener('change', (e) => {
    state.filters.date = e.target.value;
    renderEntries();
  });
  document.getElementById('filter-clear').addEventListener('click', clearFilters);
}

function clearFilters() {
  state.filters.type = 'all';
  state.filters.size = 'all';
  state.filters.date = 'all';
  document.getElementById('filter-type').value = 'all';
  document.getElementById('filter-size').value = 'all';
  document.getElementById('filter-date').value = 'all';
  renderEntries();
}

export function applyFilters(entries) {
  const f = state.filters;
  if (f.type === 'all' && f.size === 'all' && f.date === 'all') return entries;

  const now = Date.now() / 1000;
  const day = 86400;

  return entries.filter(e => {
    // Always show directories regardless of type/size filter (but date applies)
    if (!e.is_dir) {
      // Type filter
      if (f.type !== 'all') {
        const ext = (e.extension || '').toLowerCase();
        if (f.type === 'other') {
          const known = Object.values(TYPE_GROUPS).flat();
          if (known.includes(ext)) return false;
        } else {
          const group = TYPE_GROUPS[f.type] || [];
          if (!group.includes(ext)) return false;
        }
      }
      // Size filter
      if (f.size !== 'all') {
        const sz = e.size;
        if (f.size === 'tiny' && sz >= 100 * 1024) return false;
        if (f.size === 'small' && (sz < 100 * 1024 || sz >= 10 * 1024 * 1024)) return false;
        if (f.size === 'medium' && (sz < 10 * 1024 * 1024 || sz >= 100 * 1024 * 1024)) return false;
        if (f.size === 'large' && (sz < 100 * 1024 * 1024 || sz >= 1024 * 1024 * 1024)) return false;
        if (f.size === 'huge' && sz < 1024 * 1024 * 1024) return false;
      }
    } else if (f.type !== 'all' || f.size !== 'all') {
      // If type or size filter active, hide directories
      return false;
    }
    // Date filter (applies to dirs and files)
    if (f.date !== 'all') {
      const age = now - e.modified;
      if (f.date === 'today' && age >= day) return false;
      if (f.date === 'week' && age >= 7 * day) return false;
      if (f.date === 'month' && age >= 30 * day) return false;
      if (f.date === 'year' && age >= 365 * day) return false;
    }
    return true;
  });
}

export function hasActiveFilters() {
  return state.filters.type !== 'all' || state.filters.size !== 'all' || state.filters.date !== 'all';
}
