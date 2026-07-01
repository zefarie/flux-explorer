import { invoke } from './state.js';

let currentStatus = { is_repo: false, branch: '', statuses: {} };

function statusSignature(s) {
  if (!s || !s.is_repo) return '';
  // Stable, cheap signature over branch + every path:status pair, so callers
  // can skip a re-render when the git state hasn't actually changed.
  const keys = Object.keys(s.statuses).sort();
  let sig = s.branch + '|';
  for (const k of keys) sig += k + ':' + s.statuses[k] + ';';
  return sig;
}

// Returns { status, changed } where `changed` is true only when the git state
// differs from what was previously loaded (avoids a redundant re-render).
export async function loadGitStatus(path) {
  const prevSig = statusSignature(currentStatus);
  try {
    currentStatus = await invoke('get_git_status', { path });
  } catch (_) {
    currentStatus = { is_repo: false, branch: '', statuses: {} };
  }
  return { status: currentStatus, changed: statusSignature(currentStatus) !== prevSig };
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
