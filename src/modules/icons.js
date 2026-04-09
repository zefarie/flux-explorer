export function getFileIcon(entry) {
  if (entry.is_dir) {
    return {
      colorClass: 'icon-folder',
      svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
    };
  }

  const ext = entry.extension;
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'];
  const audioExts = ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'opus'];
  const codeExts = ['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'lua', 'sh', 'bash', 'zsh', 'fish', 'html', 'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'graphql', 'vue', 'svelte'];
  const archiveExts = ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z', 'zst'];
  const docExts = ['pdf', 'doc', 'docx', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'];
  const textExts = ['txt', 'md', 'log', 'cfg', 'conf', 'ini', 'env'];

  if (imageExts.includes(ext)) {
    return { colorClass: 'icon-image', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' };
  }
  if (videoExts.includes(ext)) {
    return { colorClass: 'icon-video', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' };
  }
  if (audioExts.includes(ext)) {
    return { colorClass: 'icon-audio', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' };
  }
  if (codeExts.includes(ext)) {
    return { colorClass: 'icon-code', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' };
  }
  if (archiveExts.includes(ext)) {
    return { colorClass: 'icon-archive', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>' };
  }
  if (docExts.includes(ext)) {
    return { colorClass: 'icon-document', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' };
  }
  if (textExts.includes(ext)) {
    return { colorClass: 'icon-text', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' };
  }

  if (entry.name.endsWith('.AppImage') || entry.name.endsWith('.run')) {
    return { colorClass: 'icon-exec', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' };
  }

  return { colorClass: 'icon-default', svg: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' };
}
