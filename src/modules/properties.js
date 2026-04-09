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

    title.textContent = `Proprietes - ${props.name}`;

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
      <tr><td>Proprietaire</td><td>${escapeHtml(props.owner)}</td></tr>
      <tr><td>Groupe</td><td>${escapeHtml(props.group)}</td></tr>
      <tr><td>Modifie</td><td>${formatDate(props.modified)}</td></tr>
      <tr><td>Accede</td><td>${formatDate(props.accessed)}</td></tr>
      <tr><td>Cree</td><td>${formatDate(props.created)}</td></tr>
    `;

    content.innerHTML = `<table>${rows}</table>`;
  } catch (err) {
    content.innerHTML = `<p style="color:var(--red)">${escapeHtml(String(err))}</p>`;
  }
}

function hideProperties() {
  document.getElementById('properties-overlay').classList.add('hidden');
}
