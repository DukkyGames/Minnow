/**
 * In-memory Brain code-index progress (polled by /api/brain/code/status).
 */

/** @type {Map<string, { indexing: boolean, filesDone: number, filesTotal: number, phase: string }>} */
const progressByRepo = new Map();

/** @type {((repo: string, snapshot: { indexing: boolean, filesDone: number, filesTotal: number, phase: string }) => void) | null} */
let progressForwarder = null;

/** Optional IPC hook (Brain index child process → parent). */
export function setIndexProgressForwarder(fn) {
  progressForwarder = typeof fn === 'function' ? fn : null;
}

/**
 * @param {string} repo
 * @param {{ indexing: boolean, filesDone: number, filesTotal: number, phase: string }} snapshot
 */
export function reportIndexProgress(repo, snapshot) {
  const key = String(repo ?? '').trim() || 'workspace';
  progressByRepo.set(key, snapshot);
  progressForwarder?.(key, snapshot);
}

/** @param {string} repo */
export function getIndexProgress(repo) {
  const key = String(repo ?? '').trim() || 'workspace';
  return (
    progressByRepo.get(key) ?? {
      indexing: false,
      filesDone: 0,
      filesTotal: 0,
      phase: 'idle',
    }
  );
}

/** @param {string} repo */
export function clearIndexProgress(repo) {
  const key = String(repo ?? '').trim() || 'workspace';
  progressByRepo.delete(key);
}
