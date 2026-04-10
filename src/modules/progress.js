import { invoke, listen } from './state.js';
import { formatSize, escapeHtml } from './utils.js';

let unlistenProgress = null;
let currentOperationId = null;
let lastBytes = 0;
let lastTime = 0;
let speedSamples = [];

function formatSpeed(bytesPerSec) {
  return formatSize(bytesPerSec) + '/s';
}

function formatETA(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

function showOverlay() {
  document.getElementById('progress-overlay').classList.remove('hidden');
}

function hideOverlay() {
  document.getElementById('progress-overlay').classList.add('hidden');
  currentOperationId = null;
  speedSamples = [];
  lastBytes = 0;
  lastTime = 0;
}

function updateProgress(data) {
  if (data.operation_id !== currentOperationId) return;

  const pct = data.bytes_total > 0 ? (data.bytes_done / data.bytes_total) * 100 : 0;
  const now = performance.now();

  // Compute speed from rolling window
  if (lastTime > 0) {
    const dt = (now - lastTime) / 1000;
    const dBytes = data.bytes_done - lastBytes;
    if (dt > 0) {
      speedSamples.push(dBytes / dt);
      if (speedSamples.length > 5) speedSamples.shift();
    }
  }
  lastBytes = data.bytes_done;
  lastTime = now;

  const avgSpeed = speedSamples.length > 0
    ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length
    : 0;
  const remaining = data.bytes_total - data.bytes_done;
  const eta = avgSpeed > 0 ? remaining / avgSpeed : Infinity;

  document.getElementById('progress-file').textContent = data.current_file || '';
  document.getElementById('progress-bar-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = `${pct.toFixed(1)}%`;
  document.getElementById('progress-bytes').textContent = `${formatSize(data.bytes_done)} / ${formatSize(data.bytes_total)}`;
  document.getElementById('progress-files').textContent = `${data.files_done} / ${data.files_total} fichiers`;
  document.getElementById('progress-speed').textContent = avgSpeed > 0 ? formatSpeed(avgSpeed) : '--';
  document.getElementById('progress-eta').textContent = eta < Infinity ? `ETA ${formatETA(eta)}` : '';
}

export function setupProgress() {
  document.getElementById('progress-cancel').addEventListener('click', async () => {
    try {
      await invoke('cancel_operation');
    } catch (_) {}
  });

  // Listen to progress events
  listen('copy-progress', (event) => {
    updateProgress(event.payload);
  });
}

export async function copyWithProgress(sources, destination) {
  currentOperationId = `op-${Date.now()}`;
  speedSamples = [];
  lastBytes = 0;
  lastTime = performance.now();

  document.getElementById('progress-title').textContent = 'Copie en cours';
  document.getElementById('progress-file').textContent = 'Pr\u00e9paration...';
  document.getElementById('progress-bar-fill').style.width = '0%';
  document.getElementById('progress-pct').textContent = '0%';
  document.getElementById('progress-bytes').textContent = '0 o / 0 o';
  document.getElementById('progress-files').textContent = '0 / 0 fichiers';
  document.getElementById('progress-speed').textContent = '--';
  document.getElementById('progress-eta').textContent = '';
  showOverlay();

  try {
    await invoke('copy_items_progress', {
      sources,
      destination,
      operationId: currentOperationId,
    });
  } finally {
    hideOverlay();
  }
}
