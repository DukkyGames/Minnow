/**
 * Boot resume gate for orchestrate boards.
 *
 * A board whose journal says `running` restarts on its own: `engine.load()` ends
 * with `if (state.status === 'running') startTimer()`, and engines are created
 * lazily, so the first request that touches a board after a restart silently
 * resumes its agents. That is the same "work restarts with nobody asked" class
 * the chat boot resume gate exists to prevent (`src/boot/resume-gate-boot.ts`).
 *
 * The hold has to live here rather than in the renderer: the client cannot gate
 * what a bare GET already started, and a headless boot has no client at all.
 *
 * Disarmed by default. Production arms it once in `applyMinnowMiddlewares`, the
 * same seam that sets the effector factory, so the engine suites keep today's
 * load-and-run behaviour without opting in.
 */

/**
 * @typedef {object} PendingBoardResume
 * @property {string} boardId
 * @property {() => void} resume  Start the tick timer `load()` skipped.
 * @property {() => Promise<void>} decline  Persist a user stop.
 * @property {() => { name?: string, tasks?: Map<string, unknown> | unknown[] }} peek
 */

let armed = false;

/** Boards held at load, awaiting an answer. @type {Map<string, PendingBoardResume>} */
const pending = new Map();

/**
 * Boards already answered in this process. A board resumed (or declined) once
 * must not re-prompt when its engine is disposed and lazily rebuilt.
 *
 * @type {Set<string>}
 */
const resolved = new Set();

/** Arm the gate. Production boot only — see the module note. */
export function armBoardResumeGate() {
  armed = true;
}

/** @returns {boolean} */
export function isBoardResumeGateArmed() {
  return armed;
}

/**
 * True when `load()` must hold this board instead of starting its timer.
 *
 * @param {string} boardId
 * @returns {boolean}
 */
export function shouldHoldBoardResume(boardId) {
  return armed && !resolved.has(boardId);
}

/**
 * Register a board held at load.
 *
 * @param {PendingBoardResume} entry
 * @returns {void}
 */
export function holdBoardResume(entry) {
  pending.set(entry.boardId, entry);
}

/**
 * Boards waiting on an answer, as prompt rows.
 *
 * Reports name + task count, matching what `GET /api/boards` already exposes.
 * A per-status breakdown is deliberately not attempted here: derived task
 * `status` is null at rest in V2, so counting it produced zeroes.
 *
 * @returns {Array<{ boardId: string, name: string, taskCount: number }>}
 */
export function listPendingBoardResumes() {
  const rows = [];
  for (const entry of pending.values()) {
    let name = '';
    let taskCount = 0;
    try {
      const state = entry.peek();
      name = typeof state?.name === 'string' ? state.name : '';
      // `BoardState.tasks` is a Map; tolerate an array so tests can hand a plain one.
      const raw = state?.tasks;
      taskCount = raw instanceof Map ? raw.size : Array.isArray(raw) ? raw.length : 0;
    } catch {
      // A board whose state cannot be read is still worth listing by id.
    }
    rows.push({ boardId: entry.boardId, name, taskCount });
  }
  return rows;
}

/**
 * Answer one board.
 *
 * `resume` starts the timer `load()` skipped. `decline` persists a user stop, so
 * the board reads as Stopped, Start re-arms it, and the next boot does not ask
 * about it again.
 *
 * @param {string} boardId
 * @param {'resume' | 'decline'} decision
 * @returns {Promise<boolean>} false when nothing was pending for that id
 */
export async function resolveBoardResume(boardId, decision) {
  const entry = pending.get(boardId);
  if (!entry) return false;
  pending.delete(boardId);
  resolved.add(boardId);
  if (decision === 'resume') entry.resume();
  else await entry.decline();
  return true;
}

/**
 * Answer every pending board at once — what the boot prompt actually does.
 *
 * @param {'resume' | 'decline'} decision
 * @returns {Promise<string[]>} the board ids that were answered
 */
export async function resolveAllBoardResumes(decision) {
  const ids = [...pending.keys()];
  for (const boardId of ids) {
    await resolveBoardResume(boardId, decision);
  }
  return ids;
}

/** Test helper — drop gate state between runs. */
export function resetBoardResumeGateForTests() {
  armed = false;
  pending.clear();
  resolved.clear();
}
