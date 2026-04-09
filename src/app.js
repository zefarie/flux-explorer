// ============================================
// FLUX EXPLORER -- Entry Point
// ============================================

import { state, invoke, listen, savedPrefs } from './modules/state.js';
import { navigateTo, setupPathInput } from './modules/navigation.js';
import { setupFileArea, setViewMode, toggleHidden } from './modules/files.js';
import { setupDragDrop } from './modules/dragdrop.js';
import { setupKeyboard, setupToolbarSearch } from './modules/keyboard.js';
import { setupContextMenu } from './modules/context-menu.js';
import { setupDialogs } from './modules/dialogs.js';
import { setupPreview } from './modules/preview.js';
import { loadQuickAccess } from './modules/sidebar.js';
import { refresh, goBack, goForward, goUp } from './modules/navigation.js';
import { setupTabs, initTabs } from './modules/tabs.js';
import { setupTitlebar } from './modules/titlebar.js';
import { loadBookmarks } from './modules/bookmarks.js';
import { setupProperties } from './modules/properties.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Titlebar
  setupTitlebar();

  // Toolbar buttons
  document.getElementById('btn-back').addEventListener('click', goBack);
  document.getElementById('btn-forward').addEventListener('click', goForward);
  document.getElementById('btn-up').addEventListener('click', goUp);
  document.getElementById('btn-refresh').addEventListener('click', refresh);
  document.getElementById('btn-view-grid').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('btn-view-list').addEventListener('click', () => setViewMode('list'));
  document.getElementById('btn-hidden').addEventListener('click', toggleHidden);

  // Setup modules
  setupPathInput();
  setupToolbarSearch();
  setupFileArea();
  setupDragDrop();
  setupKeyboard();
  setupContextMenu();
  setupDialogs();
  setupPreview();
  setupProperties();
  setupTabs();
  await loadQuickAccess();
  loadBookmarks();

  // Restore UI state from prefs
  document.getElementById('btn-view-grid').classList.toggle('active', state.viewMode === 'grid');
  document.getElementById('btn-view-list').classList.toggle('active', state.viewMode === 'list');
  document.getElementById('btn-hidden').classList.toggle('active', state.showHidden);

  // Auto-refresh when filesystem changes
  listen('fs-changed', () => refresh());

  // Initialize first tab and navigate
  const home = await invoke('get_home');
  const startPath = savedPrefs.lastPath || home;
  await initTabs(startPath);
  await navigateTo(startPath);
});
