/**
 * MIN-752 — boardBelongsToWorkspace inference for stamped and legacy journals.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { resetMinnowHomeCache } from '../../server/config/home.js';
import { derive } from '../../server/orchestrator/core/derive.js';
import { makeEvent } from '../../server/orchestrator/core/events.js';
import { boardBelongsToWorkspace } from '../../server/orchestrator/workspace-scope.js';
import { getBoardWorktreesDir, getWorktreesRoot } from '../../server/worktree/paths.js';

const TASKS = [
  { id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['src/a.ts'], build: 'b', test: 't', accept: 'x' },
];

function created(extra = {}) {
  return makeEvent('board.created', {
    boardId: extra.boardId ?? 'legacy-board',
    planPath: extra.planPath ?? 'documentation/plans/demo.md',
    name: 'demo',
    tasks: TASKS,
    waves: [],
    ...extra,
  });
}

/** @type {string | undefined} */
let previousHome;

before(() => {
  previousHome = process.env.MINNOW_HOME;
});

beforeEach(async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scope-'));
  process.env.MINNOW_HOME = home;
  resetMinnowHomeCache();
});

afterEach(async () => {
  const home = process.env.MINNOW_HOME;
  if (home) await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

after(() => {
  if (previousHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = previousHome;
  resetMinnowHomeCache();
});

describe('boardBelongsToWorkspace', () => {
  it('keeps a board whose stamped workspacePath matches the live root', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scope-ws-'));
    try {
      const state = derive([
        { ...created({ workspacePath: path.resolve(ws) }), seq: 1, ts: 1 },
      ]);
      assert.equal(await boardBelongsToWorkspace(state, ws), true);
    } finally {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('excludes a board stamped for another workspace', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scope-ws-'));
    try {
      const state = derive([
        { ...created({ workspacePath: '/other/repo' }), seq: 1, ts: 1 },
      ]);
      assert.equal(await boardBelongsToWorkspace(state, ws), false);
    } finally {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('infers a legacy never-run board from a plan file in this workspace', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scope-ws-'));
    try {
      await fs.mkdir(path.join(ws, 'documentation', 'plans'), { recursive: true });
      await fs.writeFile(path.join(ws, 'documentation', 'plans', 'demo.md'), '# Demo\n');
      const state = derive([{ ...created(), seq: 1, ts: 1 }]);
      assert.equal(state.workspacePath, null);
      assert.equal(await boardBelongsToWorkspace(state, ws), true);
    } finally {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('excludes a legacy board that already has a slot under another repo key', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scope-ws-'));
    try {
      await fs.mkdir(path.join(ws, 'documentation', 'plans'), { recursive: true });
      await fs.writeFile(path.join(ws, 'documentation', 'plans', 'demo.md'), '# Demo\n');
      await fs.mkdir(path.join(getWorktreesRoot(), 'otherrepo-deadbeef', 'legacy-board'), {
        recursive: true,
      });
      const state = derive([{ ...created(), seq: 1, ts: 1 }]);
      assert.equal(await boardBelongsToWorkspace(state, ws), false);
    } finally {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('keeps a legacy board that has a slot under this workspace repo', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scope-ws-'));
    try {
      const state = derive([{ ...created({ boardId: 'slotted' }), seq: 1, ts: 1 }]);
      await fs.mkdir(getBoardWorktreesDir('slotted', ws), { recursive: true });
      assert.equal(await boardBelongsToWorkspace(state, ws), true);
    } finally {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });
});
