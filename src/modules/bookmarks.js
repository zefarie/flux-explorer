import { escapeHtml, escapeAttr } from './utils.js';
import { navigateTo } from './navigation.js';

const BOOKMARKS_KEY = 'flux-explorer-bookmarks';

let bookmarks = [];

export function loadBookmarks() {
  try {
    const saved = localStorage.getItem(BOOKMARKS_KEY);
    bookmarks = saved ? JSON.parse(saved) : [];
  } catch (_) {
    bookmarks = [];
  }
  renderBookmarks();
}

function saveBookmarks() {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch (_) {}
}

export function addBookmark(path) {
  if (bookmarks.includes(path)) return;
  bookmarks.push(path);
  saveBookmarks();
  renderBookmarks();
}

export function removeBookmark(path) {
  bookmarks = bookmarks.filter(b => b !== path);
  saveBookmarks();
  renderBookmarks();
}

export function isBookmarked(path) {
  return bookmarks.includes(path);
}

export function toggleBookmark(path) {
  if (isBookmarked(path)) {
    removeBookmark(path);
  } else {
    addBookmark(path);
  }
}

function renderBookmarks() {
  const container = document.getElementById('bookmarks');
  const section = document.getElementById('bookmarks-section');
  if (!container || !section) return;

  if (bookmarks.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const folderSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="color:var(--yellow)"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';

  container.innerHTML = bookmarks.map(path => {
    const name = path.split('/').filter(Boolean).pop() || '/';
    return `<div class="sidebar-item" data-path="${escapeAttr(path)}">
      ${folderSvg}
      <span>${escapeHtml(name)}</span>
      <span class="bookmark-remove" data-bookmark-remove="${escapeAttr(path)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    </div>`;
  }).join('');

  container.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-bookmark-remove]');
    if (removeBtn) {
      e.stopPropagation();
      removeBookmark(removeBtn.dataset.bookmarkRemove);
      return;
    }
    const item = e.target.closest('.sidebar-item');
    if (item) navigateTo(item.dataset.path);
  });
}
