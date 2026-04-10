import { invoke } from './state.js';
import { formatSize, formatDate, escapeHtml } from './utils.js';

export function setupProperties() {
  document.getElementById('properties-close').addEventListener('click', hideProperties);
  document.getElementById('properties-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'properties-overlay') hideProperties();
  });
}

export async function showProperties(path) {
  const overlay = document.getElementById('properties-overlay');
  const content = document.getElementById('properties-content');
  const title = document.getElementById('properties-title');

  content.innerHTML = '<div class="spinner"></div>';
  overlay.classList.remove('hidden');

  try {
    const props = await invoke('get_file_properties', { path });

    title.textContent = `Propri\u00e9t\u00e9s - ${props.name}`;

    let rows = `
      <tr><td>Nom</td><td>${escapeHtml(props.name)}</td></tr>
      <tr><td>Chemin</td><td>${escapeHtml(props.path)}</td></tr>
      <tr><td>Type</td><td>${escapeHtml(props.mime_type)}${props.is_symlink ? ' (lien symbolique)' : ''}</td></tr>
      <tr><td>Taille</td><td>${formatSize(props.size)}</td></tr>
    `;

    if (props.file_count !== null && props.file_count !== undefined) {
      rows += `<tr><td>Contenu</td><td>${props.file_count} fichier${props.file_count > 1 ? 's' : ''}, ${props.dir_count} dossier${props.dir_count > 1 ? 's' : ''}</td></tr>`;
    }

    rows += `
      <tr><td>Permissions</td><td>${props.permissions}</td></tr>
      <tr><td>Propri\u00e9taire</td><td>${escapeHtml(props.owner)}</td></tr>
      <tr><td>Groupe</td><td>${escapeHtml(props.group)}</td></tr>
      <tr><td>Modifi\u00e9</td><td>${formatDate(props.modified)}</td></tr>
      <tr><td>Acc\u00e9d\u00e9</td><td>${formatDate(props.accessed)}</td></tr>
      <tr><td>Cr\u00e9\u00e9</td><td>${formatDate(props.created)}</td></tr>
    `;

    let html = `<table>${rows}</table>`;

    // Try to load EXIF for image files
    const imageExts = ['jpg', 'jpeg', 'tiff', 'tif', 'heic', 'heif', 'png'];
    const ext = props.name.split('.').pop()?.toLowerCase();
    if (imageExts.includes(ext)) {
      try {
        const exif = await invoke('get_exif', { path });
        if (exif.tags && exif.tags.length > 0) {
          html += '<div class="properties-section">EXIF</div>';
          html += '<table>' + exif.tags.map(([k, v]) =>
            `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`
          ).join('') + '</table>';
        }
      } catch (_) {}
    }

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<p style="color:var(--red)">${escapeHtml(String(err))}</p>`;
  }
}

function hideProperties() {
  document.getElementById('properties-overlay').classList.add('hidden');
}
