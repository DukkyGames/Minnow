/**
 * The child half of P1-G's recovery proof.
 *
 * Runs a real board — real journal, real filesystem — and kills itself with
 * SIGKILL at a chosen instant. The parent then restarts against the same
 * `MINNOW_HOME` and checks that restart *is* recovery.
 *
 * SIGKILL rather than a thrown error on purpose: a process that gets to run its
 * `finally` blocks is not a crash, and V1's recovery code existed precisely for
 * the cases where nothing got to clean up.
 *
 * Usage: `node recovery-child.mjs <boardId> <mode> <arg>`
 *   killAfter <n>        kill immediately after the nth event is appended
 *   killOnStart <n>      kill the moment the nth `effector.start()` resolves,
 *                        before its `task.attempt.started` can be written
 *   run                  run to completion and exit cleanly
 */

import { makeEvent } from '../../server/orchestrator/core/events.js';
import { createEngine } from '../../server/orchestrator/engine.js';
import { createScriptedEffector } from '../../server/orchestrator/effector-scripted.js';
import { appendEvent, createBoard } from '../../server/orchestrator/journal.js';

const [, , boardId, mode, rawArg] = process.argv;
const arg = Number(rawArg);

/** Ten tasks, which produces a journal a little over 60 events long. */
export const TASKS = Array.from({ length: 10 }, (_, i) => ({
  id: `T${i}`,
  title: `Task ${i}`,
  wave: 1 + Math.floor(i / 4),
  dependsOn: i >= 4 ? [`T${i - 4}`] : [],
  touches: [`src/t${i}/**`],
  build: 'b',
  test: 't',
  accept: 'a',
}));

/** Deterministic: every task builds, tests, and merges first time. */
export const SCRIPT = [{ emit: { outcome: 'pass' } }];

/** Concurrency the board runs at. Four so appends genuinely interleave. */
export const CONCURRENCY = 4;

/** Immediate, unblockable death. No finallys, no flush, no cleanup. */
function die() {
  process.kill(process.pid, 'SIGKILL');
}

async function main() {
  await createBoard(boardId);
  await appendEvent(
    boardId,
    makeEvent('board.created', { boardId, planPath: 'recovery.md', tasks: TASKS, waves: [] }),
  );

  const inner = createScriptedEffector({ script: SCRIPT });

  let starts = 0;
  const effector = {
    inspect: () => inner.inspect(),
    stop: (id) => inner.stop(id),
    onEnd: (handler) => inner.onEnd(handler),
    async start(desired) {
      const handle = await inner.start(desired);
      starts += 1;
      // The process exists but the journal does not know yet. This is the
      // narrowest window in the whole engine.
      if (mode === 'killOnStart' && starts === arg) die();
      return handle;
    },
  };

  const engine = createEngine({ boardId, effector, tickMs: 250 });
  await engine.load();

  let appended = 0;
  engine.subscribe(() => {
    appended += 1;
    if (mode === 'killAfter' && appended === arg) die();
  });

  process.send?.({ ready: true });
  await engine.startBoard(CONCURRENCY);

  // Drive until the board finishes, or until it is clear it never will.
  for (let i = 0; i < 2000; i += 1) {
    if (engine.getState().finished) break;
    await engine.tick();
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  process.send?.({ finished: engine.getState().finished, appended });
  engine.dispose();
  process.exit(0);
}

if (mode) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
