const SIDEBAR_WIDTH_KEY = 'flux-explorer-sidebar-width';
const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

export function setupSidebarResize() {
  const handle = document.getElementById('sidebar-resize');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;

  // Restore saved width
  const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (saved) {
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(saved)));
    sidebar.style.width = width + 'px';
  }

  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const mainEl = document.getElementById('main');
    const mainLeft = mainEl.getBoundingClientRect().left;
    let width = e.clientX - mainLeft;
    width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
    sidebar.style.width = width + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Save width
    const width = parseInt(sidebar.style.width) || 220;
    localStorage.setItem(SIDEBAR_WIDTH_KEY, width.toString());
  });
}
