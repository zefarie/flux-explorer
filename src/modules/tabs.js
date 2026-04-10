import { state, invoke, savePrefs } from './state.js';
import { navigateTo } from './navigation.js';
import { escapeHtml } from './utils.js';

let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;

function createTabState(path) {
  return {
    id: ++tabIdCounter,
    currentPath: path || '',
    entries: [],
    selected: new Set(),
    lastSelected: null,
    history: [],
    historyIndex: -1,
    searchQuery: '',
  };
}

function saveTabToState(tab) {
  tab.currentPath = state.currentPath;
  // Don't keep entries in RAM for inactive tabs - they will be re-fetched on switch
  tab.entries = [];
  tab.selected = new Set(state.selected);
  tab.lastSelected = state.lastSelected;
  tab.history = [...state.history];
  tab.historyIndex = state.historyIndex;
  tab.searchQuery = state.searchQuery;
}

function restoreTabFromState(tab) {
  state.currentPath = tab.currentPath;
  state.entries = tab.entries;
  state.selected = new Set(tab.selected);
  state.lastSelected = tab.lastSelected;
  state.history = [...tab.history];
  state.historyIndex = tab.historyIndex;
  state.searchQuery = tab.searchQuery;
}

export function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
}

export async function createTab(path) {
  // Save current tab state before creating new one
  const current = getActiveTab();
  if (current) saveTabToState(current);

  const home = path || await invoke('get_home');
  const tab = createTabState(home);
  tabs.push(tab);
  activeTabId = tab.id;

  renderTabs();
  await navigateTo(home);
}

export async function closeTab(tabId) {
  if (tabs.length <= 1) return; // Keep at least one tab

  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  tabs.splice(idx, 1);

  if (activeTabId === tabId) {
    // Switch to adjacent tab
    const newIdx = Math.min(idx, tabs.length - 1);
    activeTabId = tabs[newIdx].id;
    restoreTabFromState(tabs[newIdx]);
    renderTabs();
    await navigateTo(tabs[newIdx].currentPath, false);
  } else {
    renderTabs();
  }
}

export async function switchTab(tabId) {
  if (tabId === activeTabId) return;

  // Save current (drops entries to free RAM)
  const current = getActiveTab();
  if (current) saveTabToState(current);

  activeTabId = tabId;
  const tab = getActiveTab();
  if (!tab) return;

  restoreTabFromState(tab);
  renderTabs();

  // Always re-fetch (entries were dropped) - but skip history push
  await navigateTo(tab.currentPath, false);
  document.getElementById('search-input').value = state.searchQuery;
}

export function renderTabs() {
  const list = document.getElementById('tab-list');

  list.innerHTML = tabs.map(tab => {
    const name = tab.currentPath.split('/').filter(Boolean).pop() || '/';
    const isActive = tab.id === activeTabId;
    return `<div class="tab${isActive ? ' active' : ''}" data-tab-id="${tab.id}">
      <span class="tab-name">${escapeHtml(name)}</span>
      <span class="tab-close" data-tab-close="${tab.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    </div>`;
  }).join('');
}

// Update the active tab's displayed name when navigating
export function updateActiveTabName() {
  const tab = getActiveTab();
  if (!tab) return;
  tab.currentPath = state.currentPath;
  const tabEl = document.querySelector(`.tab[data-tab-id="${tab.id}"] .tab-name`);
  if (tabEl) {
    const name = state.currentPath.split('/').filter(Boolean).pop() || '/';
    tabEl.textContent = name;
  }
}

export function setupTabs() {
  const list = document.getElementById('tab-list');
  const newBtn = document.getElementById('btn-new-tab');

  list.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-tab-close]');
    if (closeBtn) {
      e.stopPropagation();
      closeTab(parseInt(closeBtn.dataset.tabClose));
      return;
    }

    const tabEl = e.target.closest('.tab');
    if (tabEl) {
      switchTab(parseInt(tabEl.dataset.tabId));
    }
  });

  // Middle click to close
  list.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      const tabEl = e.target.closest('.tab');
      if (tabEl) {
        e.preventDefault();
        closeTab(parseInt(tabEl.dataset.tabId));
      }
    }
  });

  newBtn.addEventListener('click', () => createTab());
}

export function getTabCount() {
  return tabs.length;
}

// Initialize first tab
export async function initTabs(startPath) {
  const tab = createTabState(startPath);
  tabs.push(tab);
  activeTabId = tab.id;
  renderTabs();
}
