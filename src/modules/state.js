// Tauri APIs
export const { invoke } = window.__TAURI__.core;
export const { listen } = window.__TAURI__.event;

// Preferences persistence
const PREFS_KEY = 'flux-explorer-prefs';

function loadPrefs() {
  try {
    const saved = localStorage.getItem(PREFS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch (_) {
    return {};
  }
}

let savePrefsTimer = null;

export function savePrefs() {
  if (savePrefsTimer) clearTimeout(savePrefsTimer);
  savePrefsTimer = setTimeout(() => {
    savePrefsTimer = null;
    const prefs = {
      viewMode: state.viewMode,
      showHidden: state.showHidden,
      sortBy: state.sortBy,
      sortAsc: state.sortAsc,
      lastPath: state.currentPath,
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }, 300);
}

const savedPrefs = loadPrefs();

// State
export const state = {
  currentPath: '',
  entries: [],
  selected: new Set(),
  lastSelected: null,
  history: [],
  historyIndex: -1,
  viewMode: savedPrefs.viewMode || 'grid',
  showHidden: savedPrefs.showHidden || false,
  sortBy: savedPrefs.sortBy || 'name',
  sortAsc: savedPrefs.sortAsc !== undefined ? savedPrefs.sortAsc : true,
  searchQuery: '',
  contextTarget: null,
  clipboard: { paths: [], action: null },
  previewOpen: false,
};

export { savedPrefs };
