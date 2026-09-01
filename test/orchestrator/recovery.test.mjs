/**
 * P1-G — crash, restart, and reload recovery proof.
 *
 * This is the property that licenses deleting `board-boot-resume.ts`,
 * `board-display-wake.ts`, `oom-recovery.ts`, and
 * `reconcileRunningBoardsAfterDisplayWake` in Phase 4: **restart is recovery**,
 * with no reconciliation code involved. If it does not hold, Phase 4 cannot
 * proceed and the architecture is unproven.
 *
 * It is also the answer to a recorded incident class rather than a theoretical
 * one — MIN-354 v1 was reverted over a lazy-history data wipe.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';

import { resetMinnowHomeCache } from '../../server/config/home.js';
import { derive } from '../../server/orchestrator/core/derive.js';
import { makeEvent } from '../../server/orchestrator/core/events.js';
import { createEngine } from '../../server/orchestrator/engine.js';
import { createScriptedEffector } from '../../server/orchestrator/effector-scripted.js';
import {
  appendEvent,
  createBoard,
  loadState,
  readEvents,
  refreshSnapshot,
  resetJournalCache,
  snapshotPath,
} from '../../server/orchestrator/journal.js';
import { CONCURRENCY, SCRIPT, TASKS } from './recovery-child.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..');
const CHILD = path.join(HERE, 'recovery-child.mjs');

/** @type {string} */
let home;
/** @type {string | undefined} */
let previousHome;

before(() => {
  previousHome = process.env.MINNOW_HOME;
});

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-recovery-'));
  process.env.MINNOW_HOME = home;
  resetMinnowHomeCache();
  resetJournalCache();
});

after(() => {
  if (previousHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = previousHome;
  resetMinnowHomeCache();
  resetJournalCache();
});

// ---------------------------------------------------------------------------

/**
 * Run the child to its kill point and wait for it to die.
 *
 * Death is detected by the child never reporting completion, not by the exit
 * signal: Windows has no real SIGKILL, and `process.kill(pid, 'SIGKILL')` there
 * becomes a TerminateProcess whose exit is reported with no signal at all. What
 * matters is that the process stopped without finishing its work, which the
 * absence of the completion message says on every platform.
 *
 * @param {string} boardId
 * @param {'killAfter' | 'killOnStart' | 'run'} mode
 * @param {number} arg
 * @returns {Promise<{ diedEarly: boolean, code: number | null, signal: string | null, stderr: string }>}
 */
function runChild(boardId, mode, arg) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD, boardId, mode, String(arg)], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, MINNOW_HOME: home },
    });
    let stderr = '';
    let completed = false;
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('message', (message) => {
      if (message && typeof message === 'object' && 'finished' in message) completed = true;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`child hung (${mode} ${arg}): ${stderr}`));
    }, 30_000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ diedEarly: !completed, code, signal, stderr });
    });
    child.once('error', reject);
  });
}

async function settle() {
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Restart a board in this process and drive it to completion.
 *
 * **The recovery path is `loadState` + `tick`, and nothing else.** There is no
 * resume call, no reconcile call, and no repair call — because none exists.
 *
 * @param {string} boardId
 * @returns {Promise<import('../../server/orchestrator/core/types').BoardState>}
 */
async function restartAndFinish(boardId) {
  const effector = createScriptedEffector({ script: SCRIPT });
  const engine = createEngine({ boardId, effector, tickMs: 100_000 });
  await engine.load();
  try {
    await engine.startBoard(CONCURRENCY);
    for (let i = 0; i < 600; i += 1) {
      await settle();
      if (engine.getState().finished) return engine.getState();
      await engine.tick();
    }
    assert.fail(`board ${boardId} did not finish after restart`);
  } finally {
    engine.dispose();
  }
}

/** Every attempt id that was started, and every one that ended. */
function attemptIds(events) {
  const started = events.filter((e) => e.type === 'task.attempt.started');
  const ended = events.filter((e) => e.type === 'task.attempt.ended');
  return { started, ended };
}

// ---------------------------------------------------------------------------

describe('recovery — a kill at every event index', () => {
  it('recovers to a consistent board that completes, from all 60 kill points', async () => {
    // Sweep rather than sample: the interesting failures live at boundaries —
    // between a start resolving and its journal line, and during a snapshot
    // write. Note what this sweep does *not* cover: the kill fires from the
    // engine's subscriber, which runs after the append has already resolved, so
    // no run here dies with a half-written line on disk. That case is the torn
    // tail, and it has its own test below.
    const KILL_POINTS = 60;
    let killed = 0;
    let completed = 0;

    for (let at = 1; at <= KILL_POINTS; at += 1) {
      const boardId = `k${at}`;
      const result = await runChild(boardId, 'killAfter', at);

      const events = await readEvents(boardId);
      if (result.diedEarly) killed += 1;

      // Whatever survived is a well-formed journal.
      assert.deepEqual(
        events.map((e) => e.seq),
        events.map((_, i) => i + 1),
        `kill at ${at}: journal is not gaplessly numbered`,
      );
      assert.doesNotThrow(() => derive(events), `kill at ${at}: journal does not derive`);

      // The load path agrees with the fold, snapshot or no snapshot. This is the
      // assertion a mid-snapshot-write kill has to survive.
      resetJournalCache();
      assert.deepEqual(await loadState(boardId), derive(events), `kill at ${at}: loadState diverged`);

      // No attempt was ended without having been started.
      const { started, ended } = attemptIds(events);
      const startedIds = new Set(started.map((e) => e.attemptId));
      for (const end of ended) {
        assert.ok(startedIds.has(end.attemptId), `kill at ${at}: ${end.attemptId} ended unstarted`);
      }
      assert.equal(
        startedIds.size,
        started.length,
        `kill at ${at}: an attempt id was started twice`,
      );

      const state = await restartAndFinish(boardId);
      assert.equal(state.finished, true, `kill at ${at}: did not finish after restart`);
      completed += 1;
    }

    assert.equal(completed, KILL_POINTS);
    assert.ok(killed > KILL_POINTS / 2, `only ${killed} of ${KILL_POINTS} runs actually died`);
  });

  it('recovers a journal left with a half-written final line', async () => {
    // The kill sweep above cannot produce this: it fires after the append has
    // resolved. A real mid-write SIGKILL leaves a final line with no newline,
    // which is reproduced here by cutting the file — the same bytes, arrived at
    // deterministically.
    //
    // Left alone it is fatal rather than survivable: the next append lands on
    // the fragment, making one unparseable newline-terminated line, and from
    // then on every read of that board throws. The board would be bricked by a
    // crash, which is the one thing an append-only journal exists to prevent.
    const boardId = 'torn';
    await runChild(boardId, 'killAfter', 20);

    const file = path.join(home, 'boards', boardId, 'journal.jsonl');
    const whole = await fs.readFile(file, 'utf8');
    const lastLineStart = whole.lastIndexOf('\n', whole.length - 2) + 1;
    assert.ok(lastLineStart > 0, 'the child wrote too little to tear');
    // Cut the last line in half, newline and all.
    const cut = lastLineStart + Math.floor((whole.length - 1 - lastLineStart) / 2);
    await fs.writeFile(file, whole.slice(0, cut), 'utf8');
    resetJournalCache();

    const before = await readEvents(boardId);
    assert.deepEqual(
      before.map((e) => e.seq),
      before.map((_, i) => i + 1),
      'the torn journal does not read back gaplessly',
    );

    // The recovery path, unchanged: load, then tick.
    const state = await restartAndFinish(boardId);
    assert.equal(state.finished, true);

    resetJournalCache();
    const after = await readEvents(boardId);
    assert.deepEqual(after.map((e) => e.seq), after.map((_, i) => i + 1));
    assert.deepEqual(await loadState(boardId), derive(after));
  });

  it('starts exactly one attempt when killed between start() and the journal append', async () => {
    // The narrowest window in the engine: the process exists, and the journal
    // does not know. Nothing was journaled, so the restarted engine must start
    // it fresh — one attempt afterwards, not zero and not two.
    const boardId = 'window';
    const result = await runChild(boardId, 'killOnStart', 1);
    assert.equal(result.diedEarly, true, `child completed instead of dying: ${result.stderr}`);

    const events = await readEvents(boardId);
    assert.equal(
      events.filter((e) => e.type === 'task.attempt.started').length,
      0,
      'an attempt was journaled before it was licensed to be',
    );

    resetJournalCache();
    const state = await restartAndFinish(boardId);
    assert.equal(state.finished, true);

    const after = await readEvents(boardId);
    const firstTask = after.find((e) => e.type === 'task.attempt.started');
    const startsForThatTask = after.filter(
      (e) => e.type === 'task.attempt.started' && e.taskId === firstTask.taskId && e.role === 'builder',
    );
    assert.equal(startsForThatTask.length, 1, 'the lost attempt was started twice');
  });

  it('survives a kill during a burst of concurrent appends — the OOM analogue', async () => {
    // At N=4 several attempts end at once, so the journal is taking interleaved
    // appends when the process dies.
    const boardId = 'burst';
    await runChild(boardId, 'killAfter', 25);

    const events = await readEvents(boardId);
    assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i + 1));
    resetJournalCache();
    assert.deepEqual(await loadState(boardId), derive(events));
    assert.equal((await restartAndFinish(boardId)).finished, true);
  });

  it('discards a snapshot written over mid-flight and folds the journal instead', async () => {
    const boardId = 'snap';
    await runChild(boardId, 'killAfter', 30);
    const events = await readEvents(boardId);
    const expected = derive(events);

    await refreshSnapshot(boardId);
    // A snapshot caught halfway through being written: valid JSON prefix, no
    // more. Atomic rename means this cannot really happen, which is exactly why
    // the fallback has to be tested deliberately.
    const whole = await fs.readFile(snapshotPath(boardId), 'utf8');
    await fs.writeFile(snapshotPath(boardId), whole.slice(0, Math.floor(whole.length / 2)), 'utf8');

    resetJournalCache();
    assert.deepEqual(await loadState(boardId), expected);
    assert.equal((await restartAndFinish(boardId)).finished, true);
  });
});

// ---------------------------------------------------------------------------

describe('recovery — the display-sleep analogue', () => {
  it('recovers when every process vanishes at once, with no wake-specific code', async () => {
    const boardId = 'sleep';
    await createBoard(boardId);
    await appendEvent(
      boardId,
      makeEvent('board.created', { boardId, planPath: 'p.md', tasks: TASKS, waves: [] }),
    );

    const effector = createScriptedEffector({
      script: [{ emit: { outcome: 'pass', delayMs: 100_000 } }],
    });
    const engine = createEngine({ boardId, effector, tickMs: 100_000 });
    await engine.load();

    try {
      await engine.startBoard(CONCURRENCY);
      await settle();
      assert.equal(effector.inspect().length, CONCURRENCY, 'the board did not get going');

      // The machine slept. Every process is gone, and not one of them said so.
      effector.vanishAll();
      assert.equal(effector.inspect().length, 0);

      // Resume: a plain effector, a plain tick. Nothing knows this happened.
      const resumed = createScriptedEffector({ script: SCRIPT });
      const after = createEngine({ boardId, effector: resumed, tickMs: 100_000 });
      await after.load();
      try {
        await after.startBoard(CONCURRENCY);
        for (let i = 0; i < 600 && !after.getState().finished; i += 1) {
          await settle();
          await after.tick();
        }
        assert.equal(after.getState().finished, true);
      } finally {
        after.dispose();
      }
    } finally {
      engine.dispose();
    }
  });

  it('reloads the same state a fresh engine would derive', async () => {
    const boardId = 'reload';
    await createBoard(boardId);
    await appendEvent(
      boardId,
      makeEvent('board.created', { boardId, planPath: 'p.md', tasks: TASKS, waves: [] }),
    );
    const effector = createScriptedEffector({ script: [{ emit: { outcome: 'pass', delayMs: 100_000 } }] });
    const engine = createEngine({ boardId, effector, tickMs: 100_000 });
    await engine.load();
    try {
      await engine.startBoard(CONCURRENCY);
      await settle();

      const inMemory = engine.getState();
      const fromDisk = await loadState(boardId);
      assert.deepEqual(fromDisk, inMemory, 'the in-memory fold drifted from the journal');

      await engine.reload();
      assert.deepEqual(engine.getState(), inMemory);
    } finally {
      engine.dispose();
    }
  });
});

// ---------------------------------------------------------------------------

describe('recovery — there is no recovery code', () => {
  it('exposes no resume, wake, or repair entry point on the engine', async () => {
    const boardId = 'surface';
    await createBoard(boardId);
    await appendEvent(
      boardId,
      makeEvent('board.created', { boardId, planPath: 'p.md', tasks: TASKS, waves: [] }),
    );
    const engine = createEngine({ boardId, effector: createScriptedEffector({}) });
    await engine.load();
    try {
      // The boot resume gate is the one sanctioned exception: it does not
      // recover anything, it releases the tick timer `load()` withheld until
      // the user answered the prompt. Everything else still fails this.
      const BOOT_GATE_SURFACE = new Set(['wasHeldAtLoad', 'resumeAfterGate']);
      for (const name of Object.keys(engine)) {
        if (BOOT_GATE_SURFACE.has(name)) continue;
        assert.doesNotMatch(
          name,
          /resume|wake|recover|repair|reconcile|heal|stall|watchdog|nudge/i,
          `the engine exposes ${name}`,
        );
      }
      // The whole restart path, named.
      assert.equal(typeof engine.load, 'function');
      assert.equal(typeof engine.tick, 'function');
    } finally {
      engine.dispose();
    }
  });

  it('loads no resume, wake, or recovery module anywhere in the engine graph', async () => {
    // Static rather than sampled: walk every module the engine can reach and
    // assert none of them is one of the subsystems Phase 4 deletes.
    /** @type {Set<string>} */
    const seen = new Set();
    /** @param {string} file */
    const walk = async (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      let source;
      try {
        source = await fs.readFile(file, 'utf8');
      } catch {
        return;
      }
      const specifiers = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const specifier of specifiers) {
        if (!specifier.startsWith('.')) continue;
        await walk(path.resolve(path.dirname(file), specifier));
      }
    };

    await walk(path.join(PROJECT_ROOT, 'server/orchestrator/engine.js'));
    assert.ok(seen.size > 5, `only walked ${seen.size} modules`);

    for (const file of seen) {
      const name = path.basename(file);
      assert.doesNotMatch(
        name,
        /-(resume|wake|recovery)\b|^(boot-resume|display-wake|oom-recovery)/,
        `the engine reaches ${name}`,
      );
    }
    // And specifically, none of the four V1 modules this proof licenses deleting.
    for (const banned of ['board-boot-resume', 'board-display-wake', 'oom-recovery']) {
      assert.equal(
        [...seen].some((f) => f.includes(banned)),
        false,
        `the engine reaches ${banned}`,
      );
    }
  });

  it('reaches nothing under src/', async () => {
    // The engine is server-side. A single renderer import would put the board's
    // liveness back on the display being awake, which is the whole bug.
    const source = await fs.readFile(path.join(PROJECT_ROOT, 'server/orchestrator/engine.js'), 'utf8');
    for (const [, specifier] of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert.doesNotMatch(specifier, /(^|\/)src\//, `engine.js imports ${specifier}`);
    }
  });
});
