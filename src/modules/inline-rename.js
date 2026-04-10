import { state, invoke } from './state.js';
import { showToast } from './utils.js';
import { refresh } from './navigation.js';

let activeItem = null;
let activeNameEl = null;
let activeOriginal = '';
let activePath = '';
let cleanup = null;

export function startInlineRename(path) {
  // Cancel any existing rename
  if (activeItem) finishRename(true);

  const item = document.querySelector(`.file-item[data-path="${cssEscape(path)}"]`);
  if (!item) return false;

  const nameEl = item.querySelector('.file-name');
  if (!nameEl) return false;

  const entry = state.entries.find(e => e.path === path);
  if (!entry) return false;

  activeItem = item;
  activeNameEl = nameEl;
  activeOriginal = entry.name;
  activePath = path;

  nameEl.classList.add('inline-renaming');
  nameEl.contentEditable = 'plaintext-only';
  nameEl.spellcheck = false;
  nameEl.textContent = entry.name;
  nameEl.focus();

  // Select name without extension
  const range = document.createRange();
  const sel = window.getSelection();
  const textNode = nameEl.firstChild;
  if (textNode) {
    const dotIdx = !entry.is_dir && entry.name.includes('.') ? entry.name.lastIndexOf('.') : entry.name.length;
    try {
      range.setStart(textNode, 0);
      range.setEnd(textNode, dotIdx);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {
      sel.removeAllRanges();
      range.selectNodeContents(nameEl);
      sel.addRange(range);
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      finishRename(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishRename(true);
    }
    // Block other shortcuts from leaking
    e.stopPropagation();
  };

  const onBlur = () => {
    finishRename(false);
  };

  nameEl.addEventListener('keydown', onKeyDown);
  nameEl.addEventListener('blur', onBlur);

  cleanup = () => {
    nameEl.removeEventListener('keydown', onKeyDown);
    nameEl.removeEventListener('blur', onBlur);
  };

  return true;
}

async function finishRename(cancel) {
  if (!activeItem || !activeNameEl) return;

  const nameEl = activeNameEl;
  const path = activePath;
  const original = activeOriginal;
  const newName = nameEl.textContent.trim();

  if (cleanup) { cleanup(); cleanup = null; }
  nameEl.classList.remove('inline-renaming');
  nameEl.contentEditable = 'false';
  nameEl.removeAttribute('contenteditable');
  activeItem = null;
  activeNameEl = null;
  activeOriginal = '';
  activePath = '';

  if (cancel || !newName || newName === original) {
    nameEl.textContent = original;
    return;
  }

  try {
    await invoke('rename_item', { path, newName });
    await refresh();
  } catch (err) {
    nameEl.textContent = original;
    showToast(String(err), 'error');
  }
}

function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return s.replace(/(["\\])/g, '\\$1');
}
