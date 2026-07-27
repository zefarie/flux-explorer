import { state } from './state.js';
import { renderEntries } from './files.js';

// Filter definitions: each maps to a predicate over an entry
const TYPE_GROUPS = {
  image: new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif']),
  video: new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp']),
  audio: new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma']),
  doc: new Set(['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'ods', 'xls', 'xlsx', 'odp', 'ppt', 'pptx', 'epub']),
  code: new Set(['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'sh', 'lua', 'kt', 'swift', 'sql', 'html', 'css', 'json', 'yaml', 'yml', 'toml', 'xml']),
  archive: new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar']),
};

// All known extensions, for the "other" filter
const KNOWN_EXTS = new Set(Object.values(TYPE_GROUPS).flatMap(s => [...s]));

const KB = 1024, MB = KB * 1024, GB = MB * 1024;
const SIZE_RANGES = {
  tiny: [0, 100 * KB],
  small: [100 * KB, 10 * MB],
  medium: [10 * MB, 100 * MB],
  large: [100 * MB, GB],
  huge: [GB, Infinity],
};

const DAY = 86400;
const DATE_MAX_AGE = { today: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };

state.filters = {
  type: 'all',
  size: 'all',
  date: 'all',
};

export function setupFilters() {
  document.getElementById('filter-type').addEventListener('change', (e) => {
    state.filters.type = e.target.value;
    renderEntries();
    updateBadge();
  });
  document.getElementById('filter-size').addEventListener('change', (e) => {
    state.filters.size = e.target.value;
    renderEntries();
    updateBadge();
  });
  document.getElementById('filter-date').addEventListener('change', (e) => {
    state.filters.date = e.target.value;
    renderEntries();
    updateBadge();
  });
  document.getElementById('filter-clear').addEventListener('click', clearFilters);

  const btn = document.getElementById('btn-filter');
  const popover = document.getElementById('filter-popover');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (popover.classList.contains('hidden')) return;
    if (popover.contains(e.target) || btn.contains(e.target)) return;
    popover.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.classList.contains('hidden')) {
      popover.classList.add('hidden');
    }
  });
}

function clearFilters() {
  state.filters.type = 'all';
  state.filters.size = 'all';
  state.filters.date = 'all';
  document.getElementById('filter-type').value = 'all';
  document.getElementById('filter-size').value = 'all';
  document.getElementById('filter-date').value = 'all';
  renderEntries();
  updateBadge();
}

function updateBadge() {
  const badge = document.getElementById('filter-badge');
  const btn = document.getElementById('btn-filter');
  const count = ['type', 'size', 'date'].filter(k => state.filters[k] !== 'all').length;
  if (count > 0) {
    badge.textContent = String(count);
    badge.classList.remove('hidden');
    btn.classList.add('active');
  } else {
    badge.classList.add('hidden');
    btn.classList.remove('active');
  }
}

export function applyFilters(entries) {
  const f = state.filters;
  if (!hasActiveFilters()) return entries;

  const now = Date.now() / 1000;
  const sizeRange = SIZE_RANGES[f.size];
  const maxAge = DATE_MAX_AGE[f.date];

  return entries.filter(e => {
    if (e.is_dir) {
      // Type/size filters only make sense for files: hide directories
      if (f.type !== 'all' || f.size !== 'all') return false;
    } else {
      if (f.type !== 'all') {
        const ext = (e.extension || '').toLowerCase();
        const matches = f.type === 'other'
          ? !KNOWN_EXTS.has(ext)
          : TYPE_GROUPS[f.type]?.has(ext);
        if (!matches) return false;
      }
      if (sizeRange && (e.size < sizeRange[0] || e.size >= sizeRange[1])) return false;
    }
    // Date filter (applies to dirs and files)
    if (maxAge && now - e.modified >= maxAge) return false;
    return true;
  });
}

export function hasActiveFilters() {
  return state.filters.type !== 'all' || state.filters.size !== 'all' || state.filters.date !== 'all';
}
