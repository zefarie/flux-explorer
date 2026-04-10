import { state, invoke } from './state.js';
import { showToast } from './utils.js';
import { refresh } from './navigation.js';

export async function isArchive(path) {
  try {
    return await invoke('is_archive', { path });
  } catch (_) {
    return false;
  }
}

export async function extractArchive(archivePath, destination) {
  showToast('Extraction en cours...', 'info');
  try {
    await invoke('extract_archive', { path: archivePath, destination });
    showToast('Extraction termin\u00e9e', 'success');
    await refresh();
  } catch (err) {
    showToast(String(err), 'error');
  }
}

export async function extractHere(archivePath) {
  // Extract to the parent directory of the archive
  const parent = archivePath.substring(0, archivePath.lastIndexOf('/')) || '/';
  await extractArchive(archivePath, parent);
}

export async function createArchive(sources, format) {
  if (sources.length === 0) return;

  // Default name from first selected item
  const firstName = sources[0].split('/').pop() || 'archive';
  const baseName = firstName.replace(/\.[^.]+$/, '');
  const ext = format === '7z' ? '.7z' : format === 'zip' ? '.zip' : `.${format}`;
  const destination = `${state.currentPath}/${baseName}${ext}`;

  showToast(`Cr\u00e9ation de ${baseName}${ext}...`, 'info');
  try {
    await invoke('create_archive', { sources, destination, format });
    showToast('Archive cr\u00e9\u00e9e', 'success');
    await refresh();
  } catch (err) {
    showToast(String(err), 'error');
  }
}
