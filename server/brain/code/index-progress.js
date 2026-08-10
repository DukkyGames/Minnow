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

/**
 * Outcome of the most recent reindex job per repo. Reindex is fire-and-forget over HTTP,
 * so this is how the UI learns how the run ended after polling sees `indexing: false`.
 * @type {Map<string, Record<string, unknown>>}
 */
const lastRunByRepo = new Map();

/**
 * @param {string} repo
 * @param {Record<string, unknown>} run
 */
export function recordIndexRun(repo, run) {
  const key = String(repo ?? '').trim() || 'workspace';
  lastRunByRepo.set(key, run);
}

/** @param {string} repo */
export function getIndexRun(repo) {
  const key = String(repo ?? '').trim() || 'workspace';
  return lastRunByRepo.get(key) ?? null;
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
  lastRunByRepo.delete(key);
}
