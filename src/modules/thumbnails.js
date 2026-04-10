import { state, invoke } from './state.js';

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'];
export const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'];

// LRU cache for in-memory thumbnails (data URLs)
const MAX_CACHE_ENTRIES = 200;
const thumbCache = new Map();

function cacheGet(key) {
  if (!thumbCache.has(key)) return null;
  const value = thumbCache.get(key);
  thumbCache.delete(key);
  thumbCache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (thumbCache.has(key)) thumbCache.delete(key);
  thumbCache.set(key, value);
  while (thumbCache.size > MAX_CACHE_ENTRIES) {
    const oldest = thumbCache.keys().next().value;
    thumbCache.delete(oldest);
  }
}

let thumbObserver = null;
let observedItems = new Set();

export function getThumbType(entry) {
  if (entry.is_dir) return null;
  if (IMAGE_EXTS.includes(entry.extension)) return 'image';
  if (VIDEO_EXTS.includes(entry.extension)) return 'video';
  return null;
}

export function cleanupThumbnails() {
  if (thumbObserver) {
    for (const item of observedItems) thumbObserver.unobserve(item);
    thumbObserver.disconnect();
    thumbObserver = null;
  }
  observedItems.clear();
}

export function loadThumbnails() {
  cleanupThumbnails();

  const items = document.querySelectorAll('.file-item[data-thumb]');
  if (items.length === 0) return;

  const size = state.viewMode === 'grid' ? 128 : 48;
  let loading = 0;
  const maxConcurrent = 6;
  const queue = [];

  function processQueue() {
    while (loading < maxConcurrent && queue.length > 0) {
      const item = queue.shift();
      if (!item.isConnected) continue;
      loadSingleThumb(item, size);
    }
  }

  async function loadSingleThumb(item, size) {
    const path = item.dataset.path;
    const type = item.dataset.thumb;
    const iconEl = item.querySelector('.file-icon');
    if (!iconEl) return;

    const cacheKey = `${path}:${size}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      applyThumb(iconEl, cached);
      return;
    }

    loading++;
    try {
      let dataUrl;
      if (type === 'image') {
        dataUrl = await invoke('get_thumbnail', { path, size });
      } else {
        dataUrl = await invoke('get_video_thumbnail', { path, size });
      }
      cacheSet(cacheKey, dataUrl);
      if (item.isConnected) applyThumb(iconEl, dataUrl);
    } catch (_) {}
    loading--;
    processQueue();
  }

  thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        queue.push(entry.target);
        thumbObserver.unobserve(entry.target);
        observedItems.delete(entry.target);
      }
    }
    processQueue();
  }, { root: document.getElementById('file-area'), rootMargin: '100px' });

  items.forEach(item => {
    thumbObserver.observe(item);
    observedItems.add(item);
  });
}

function applyThumb(iconEl, dataUrl) {
  iconEl.className = 'file-icon thumb-loaded';
  iconEl.innerHTML = `<img src="${dataUrl}" alt="">`;
}
