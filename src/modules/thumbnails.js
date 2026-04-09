import { state, invoke } from './state.js';

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'];
export const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'];

const thumbCache = new Map();
let thumbObserver = null;

export function getThumbType(entry) {
  if (entry.is_dir) return null;
  if (IMAGE_EXTS.includes(entry.extension)) return 'image';
  if (VIDEO_EXTS.includes(entry.extension)) return 'video';
  return null;
}

export function loadThumbnails() {
  if (thumbObserver) thumbObserver.disconnect();

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
    if (thumbCache.has(cacheKey)) {
      applyThumb(iconEl, thumbCache.get(cacheKey));
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
      thumbCache.set(cacheKey, dataUrl);
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
      }
    }
    processQueue();
  }, { root: document.getElementById('file-area'), rootMargin: '100px' });

  items.forEach(item => thumbObserver.observe(item));
}

function applyThumb(iconEl, dataUrl) {
  iconEl.className = 'file-icon thumb-loaded';
  iconEl.innerHTML = `<img src="${dataUrl}" alt="">`;
}
