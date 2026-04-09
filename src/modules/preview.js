import { state, invoke } from './state.js';
import { formatSize, formatDate, escapeHtml, escapeAttr } from './utils.js';
import { getFileIcon } from './icons.js';
import { highlight } from './highlight.js';

const PREVIEW_TEXT_EXTS = ['txt', 'md', 'log', 'cfg', 'conf', 'ini', 'env', 'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'lua', 'sh', 'bash', 'zsh', 'fish', 'html', 'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'graphql', 'vue', 'svelte', 'Makefile', 'Dockerfile'];
const PREVIEW_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'];
const PREVIEW_VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'mov'];
const PREVIEW_AUDIO_EXTS = ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'opus'];

export function setupPreview() {
  document.getElementById('preview-close').addEventListener('click', closePreview);
  document.getElementById('preview-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'preview-overlay') closePreview();
  });
}

export async function openPreview(entry) {
  const overlay = document.getElementById('preview-overlay');
  const content = document.getElementById('preview-content');
  const filename = document.getElementById('preview-filename');
  const meta = document.getElementById('preview-meta');

  filename.textContent = entry.name;
  const metaParts = [];
  if (!entry.is_dir) metaParts.push(formatSize(entry.size));
  if (entry.permissions) metaParts.push(entry.permissions);
  meta.textContent = metaParts.join(' - ');

  content.innerHTML = '<div class="spinner"></div>';
  overlay.classList.remove('hidden');
  state.previewOpen = true;

  const ext = entry.extension;

  if (PREVIEW_IMAGE_EXTS.includes(ext)) {
    try {
      const dataUrl = await invoke('get_thumbnail', { path: entry.path, size: 800 });
      content.innerHTML = `<img src="${dataUrl}" alt="${escapeAttr(entry.name)}">`;
    } catch (_) {
      content.innerHTML = `<img src="file://${entry.path}" alt="${escapeAttr(entry.name)}">`;
    }
  } else if (PREVIEW_VIDEO_EXTS.includes(ext)) {
    content.innerHTML = `<video controls autoplay class="preview-media">
      <source src="file://${escapeAttr(entry.path)}" type="video/${ext === 'mov' ? 'quicktime' : ext}">
    </video>`;
  } else if (PREVIEW_AUDIO_EXTS.includes(ext)) {
    const mimeMap = { mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', m4a: 'audio/mp4', opus: 'audio/opus' };
    content.innerHTML = `<div class="preview-audio-wrapper">
      <div class="preview-icon icon-audio"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
      <audio controls autoplay class="preview-audio">
        <source src="file://${escapeAttr(entry.path)}" type="${mimeMap[ext] || 'audio/mpeg'}">
      </audio>
    </div>`;
  } else if (ext === 'pdf') {
    try {
      const dataUrl = await invoke('get_pdf_preview', { path: entry.path });
      content.innerHTML = `<img src="${dataUrl}" alt="${escapeAttr(entry.name)}" style="max-width:100%;max-height:100%">`;
    } catch (err) {
      content.innerHTML = `<div class="preview-info"><p style="color:var(--fg4)">${escapeHtml(String(err))}</p></div>`;
    }
  } else if (PREVIEW_TEXT_EXTS.includes(ext) || entry.name.startsWith('.') || entry.size < 500000) {
    try {
      const text = await invoke('read_text_preview', { path: entry.path, maxLines: 200 });
      const highlighted = highlight(text, ext);
      content.innerHTML = `<pre>${highlighted}</pre>`;
    } catch (_) {
      showPreviewInfo(content, entry);
    }
  } else {
    showPreviewInfo(content, entry);
  }
}

function showPreviewInfo(content, entry) {
  const iconInfo = getFileIcon(entry);
  content.innerHTML = `
    <div class="preview-info">
      <div class="preview-icon ${iconInfo.colorClass}">${iconInfo.svg}</div>
      <table>
        <tr><td>Nom</td><td>${escapeHtml(entry.name)}</td></tr>
        <tr><td>Taille</td><td>${formatSize(entry.size)}</td></tr>
        <tr><td>Modifi\u00e9</td><td>${formatDate(entry.modified)}</td></tr>
        <tr><td>Permissions</td><td>${entry.permissions || '-'}</td></tr>
        ${entry.is_symlink ? '<tr><td>Type</td><td>Lien symbolique</td></tr>' : ''}
      </table>
    </div>
  `;
}

export function closePreview() {
  document.getElementById('preview-overlay').classList.add('hidden');
  document.getElementById('preview-content').innerHTML = '';
  state.previewOpen = false;
}
