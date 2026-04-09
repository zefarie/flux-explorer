const { getCurrentWindow } = window.__TAURI__.window;

export function setupTitlebar() {
  const appWindow = getCurrentWindow();

  document.getElementById('btn-minimize').addEventListener('click', () => {
    appWindow.minimize();
  });

  document.getElementById('btn-maximize').addEventListener('click', async () => {
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      appWindow.unmaximize();
    } else {
      appWindow.maximize();
    }
  });

  document.getElementById('btn-close').addEventListener('click', () => {
    appWindow.close();
  });

  // Double-click titlebar to maximize/restore
  document.getElementById('titlebar').addEventListener('dblclick', async (e) => {
    if (e.target.closest('.titlebar-controls')) return;
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      appWindow.unmaximize();
    } else {
      appWindow.maximize();
    }
  });
}
