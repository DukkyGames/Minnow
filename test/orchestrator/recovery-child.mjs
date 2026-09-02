
import { makeEvent } from '../../server/orchestrator/core/events.js';
import { createEngine } from '../../server/orchestrator/engine.js';
import { createScriptedEffector } from '../../server/orchestrator/effector-scripted.js';
import { appendEvent, createBoard } from '../../server/orchestrator/journal.js';

const [, , boardId, mode, rawArg] = process.argv;
const arg = Number(rawArg);

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

export const SCRIPT = [{ emit: { outcome: 'pass' } }];

export const CONCURRENCY = 4;

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
