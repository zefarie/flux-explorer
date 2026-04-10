import { state, invoke } from './state.js';
import { escapeHtml, escapeAttr } from './utils.js';
import { navigateTo } from './navigation.js';
import { setViewMode, toggleHidden } from './files.js';
import { showNewFolderDialog, showNewFileDialog, showRenameDialog, showDeleteDialog } from './dialogs.js';
import { showProperties } from './properties.js';
import { showOpenWith } from './open-with.js';
import { showBatchRename } from './batch-rename.js';
import { showTrash } from './trash.js';
import { createTab, closeTab, getActiveTab, getTabCount } from './tabs.js';
import { openPreview } from './preview.js';
import { showDuplicates } from './duplicates.js';
import { showDiskUsage } from './disk-usage.js';

const ACTIONS = [
  { id: 'new-folder', label: 'Nouveau dossier', shortcut: 'Ctrl+Shift+N', icon: 'folder-plus', run: () => showNewFolderDialog() },
  { id: 'new-file', label: 'Nouveau fichier', icon: 'file-plus', run: () => showNewFileDialog() },
  { id: 'view-grid', label: 'Vue grille', icon: 'grid', run: () => setViewMode('grid') },
  { id: 'view-list', label: 'Vue liste', icon: 'list', run: () => setViewMode('list') },
  { id: 'toggle-hidden', label: 'Afficher/cacher fichiers caches', shortcut: 'Ctrl+H', icon: 'eye', run: () => toggleHidden() },
  { id: 'new-tab', label: 'Nouvel onglet', shortcut: 'Ctrl+T', icon: 'tab', run: () => createTab() },
  { id: 'close-tab', label: 'Fermer onglet', shortcut: 'Ctrl+W', icon: 'x', run: () => { const t = getActiveTab(); if (t && getTabCount() > 1) closeTab(t.id); } },
  { id: 'trash', label: 'Ouvrir la corbeille', icon: 'trash', run: () => showTrash() },
  { id: 'home', label: 'Aller au dossier personnel', icon: 'home', run: async () => { const h = await invoke('get_home'); navigateTo(h); } },
  { id: 'root', label: 'Aller a la racine /', icon: 'disk', run: () => navigateTo('/') },
  { id: 'terminal', label: 'Ouvrir un terminal ici', icon: 'terminal', run: () => invoke('open_terminal', { path: state.currentPath }) },
  { id: 'rename', label: 'Renommer la selection', shortcut: 'F2', icon: 'edit', run: () => { if (state.selected.size === 1) showRenameDialog([...state.selected][0]); } },
  { id: 'batch-rename', label: 'Renommer en masse', icon: 'edit', run: () => { if (state.selected.size >= 2) showBatchRename([...state.selected]); } },
  { id: 'delete', label: 'Supprimer la selection', shortcut: 'Delete', icon: 'trash', run: () => { if (state.selected.size > 0) showDeleteDialog(); } },
  { id: 'properties', label: 'Proprietes', icon: 'info', run: () => { if (state.selected.size === 1) showProperties([...state.selected][0]); } },
  { id: 'open-with', label: 'Ouvrir avec...', icon: 'app', run: () => { if (state.selected.size === 1) showOpenWith([...state.selected][0]); } },
  { id: 'duplicates', label: 'Detecter les doublons', icon: 'copy', run: () => showDuplicates() },
  { id: 'disk-usage', label: 'Visualiser l\'espace disque', icon: 'disk', run: () => showDiskUsage() },
];

let palette = [];
let selectedIdx = 0;

export function setupPalette() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'k' || e.key === 'p')) {
      e.preventDefault();
      openPalette();
    }
  });

  const overlay = document.getElementById('palette-overlay');
  const input = document.getElementById('palette-input');

  overlay.addEventListener('click', (e) => {
    if (e.target.id === 'palette-overlay') closePalette();
  });

  input.addEventListener('input', () => updatePalette());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, palette.length - 1);
      renderPalette();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      renderPalette();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runSelected();
    }
  });

  document.getElementById('palette-list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-palette-idx]');
    if (item) {
      selectedIdx = parseInt(item.dataset.paletteIdx);
      runSelected();
    }
  });
}

function openPalette() {
  document.getElementById('palette-overlay').classList.remove('hidden');
  const input = document.getElementById('palette-input');
  input.value = '';
  selectedIdx = 0;
  updatePalette();
  setTimeout(() => input.focus(), 50);
}

function closePalette() {
  document.getElementById('palette-overlay').classList.add('hidden');
}

function fuzzyMatch(needle, haystack) {
  if (!needle) return 1;
  needle = needle.toLowerCase();
  haystack = haystack.toLowerCase();

  if (haystack.includes(needle)) return 10;

  // Fuzzy: each char of needle must appear in order
  let i = 0;
  let score = 0;
  for (const c of haystack) {
    if (i < needle.length && c === needle[i]) {
      i++;
      score++;
    }
  }
  return i === needle.length ? score : 0;
}

function updatePalette() {
  const query = document.getElementById('palette-input').value.trim();

  // Build list: actions + current dir entries
  const items = [];

  for (const action of ACTIONS) {
    const score = fuzzyMatch(query, action.label);
    if (score > 0) {
      items.push({ type: 'action', label: action.label, shortcut: action.shortcut, run: action.run, score });
    }
  }

  // Add current directory entries
  for (const entry of state.entries) {
    const score = fuzzyMatch(query, entry.name);
    if (score > 0) {
      items.push({
        type: entry.is_dir ? 'folder' : 'file',
        label: entry.name,
        path: entry.path,
        run: () => {
          if (entry.is_dir) navigateTo(entry.path);
          else openPreview(entry);
        },
        score: score - 1, // Slightly lower priority than actions
      });
    }
  }

  items.sort((a, b) => b.score - a.score);
  palette = items.slice(0, 50);
  selectedIdx = 0;
  renderPalette();
}

function renderPalette() {
  const list = document.getElementById('palette-list');
  if (palette.length === 0) {
    list.innerHTML = '<div class="palette-empty">Aucun resultat</div>';
    return;
  }

  list.innerHTML = palette.map((item, i) => {
    const typeIcon = item.type === 'action' ? '\u26a1' : item.type === 'folder' ? '\ud83d\udcc1' : '\ud83d\udcc4';
    const shortcut = item.shortcut ? `<span class="palette-shortcut">${escapeHtml(item.shortcut)}</span>` : '';
    return `<div class="palette-item${i === selectedIdx ? ' active' : ''}" data-palette-idx="${i}">
      <span class="palette-type">${typeIcon}</span>
      <span class="palette-label">${escapeHtml(item.label)}</span>
      ${shortcut}
    </div>`;
  }).join('');

  // Scroll active into view
  const active = list.querySelector('.palette-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function runSelected() {
  const item = palette[selectedIdx];
  if (!item) return;
  closePalette();
  setTimeout(() => item.run(), 0);
}
