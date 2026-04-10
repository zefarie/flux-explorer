import { invoke } from './state.js';

let currentStatus = { is_repo: false, branch: '', statuses: {} };

export async function loadGitStatus(path) {
  try {
    currentStatus = await invoke('get_git_status', { path });
  } catch (_) {
    currentStatus = { is_repo: false, branch: '', statuses: {} };
  }
  return currentStatus;
}

export function getGitClass(path) {
  if (!currentStatus.is_repo) return '';
  const status = currentStatus.statuses[path];
  if (!status) return '';
  return ` git-${status}`;
}

export function getGitBranch() {
  return currentStatus.is_repo ? currentStatus.branch : '';
}

export function isGitRepo() {
  return currentStatus.is_repo;
}
