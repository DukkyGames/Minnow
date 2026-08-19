/**
 * Issues schema v3 guard rails.
 *
 * MIN-354 v1 died on a data-wipe, and both Issues parsers shipped with the same
 * failure shape: an unrecognized `version` reset the state to `[]`. The server
 * copy sat on the PUT path, so a client one release ahead would have had its
 * issues erased on the first save. These tests exist to make that combination
 * impossible to reintroduce.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  validateIssuesState,
  ISSUES_COMPAT_VERSION,
  ISSUES_SCHEMA_VERSION,
} from '../../server/config/validators.js';

function card(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'bug',
    title: `Issue ${id}`,
    description: 'body',
    status: 'todo',
    priority: 'high',
    labels: ['ui'],
    workspacePath: '/repo',
    createdAt: 1_000,
    updatedAt: 2_000,
    ...extra,
  };
}

describe('issues schema forward compatibility', () => {
  test('a newer revision is read, not discarded', () => {
    const future = {
      version: ISSUES_COMPAT_VERSION,
      schemaRevision: ISSUES_SCHEMA_VERSION + 7,
      nextId: 4,
      issues: [card('MIN-1'), card('MIN-2')],
      workspaces: {},
    };

    const out = validateIssuesState(future);

    assert.equal(out.issues.length, 2, 'issues from a newer revision must survive');
    assert.deepEqual(
      out.issues.map((i: { id: string }) => i.id),
      ['MIN-1', 'MIN-2'],
    );
  });

  test('a newer revision is written back at its own number, never downgraded', () => {
    const out = validateIssuesState({
      version: ISSUES_COMPAT_VERSION,
      schemaRevision: ISSUES_SCHEMA_VERSION + 7,
      nextId: 1,
      issues: [card('MIN-1')],
    });
    assert.equal(out.schemaRevision, ISSUES_SCHEMA_VERSION + 7);
  });

  test('`version` on disk stays at the compatibility floor', () => {
    // The whole point: an older reader must never meet a `version` it rejects.
    for (const input of [
      { version: 1, nextId: 1, issues: [card('a')] },
      { version: 2, nextId: 1, issues: [card('a')] },
      { version: 2, schemaRevision: 9, nextId: 1, issues: [card('a')] },
      { nextId: 1, issues: [card('a')] },
    ]) {
      const out = validateIssuesState(input);
      assert.equal(out.version, ISSUES_COMPAT_VERSION, JSON.stringify(input));
    }
  });

  test('a v3 file survives the parser that shipped before v3 existed', () => {
    const migrated = validateIssuesState({
      version: 2,
      nextId: 3,
      issues: [card('MIN-1'), card('MIN-2')],
    });

    // Verbatim copy of the reader in the released build.
    const shippedV2Parser = (row: Record<string, unknown>) =>
      (row.version !== 1 && row.version !== 2) || !Array.isArray(row.issues)
        ? { version: 2, nextId: 1, issues: [] as unknown[] }
        : row;

    const seenByOldClient = shippedV2Parser(
      JSON.parse(JSON.stringify(migrated)) as Record<string, unknown>,
    );
    assert.equal(
      (seenByOldClient.issues as unknown[]).length,
      2,
      'a rolled-back client must still see its issues',
    );
  });

  test('fields this revision does not model survive a round trip', () => {
    const out = validateIssuesState({
      version: ISSUES_COMPAT_VERSION,
      schemaRevision: ISSUES_SCHEMA_VERSION + 1,
      nextId: 1,
      issues: [
        card('MIN-1', {
          assignee: { id: 'me', assignedAt: 5 },
          agent: { agentId: 'builder', phase: 'running', startedAt: 1, updatedAt: 2 },
          comments: [{ id: 'c1', authorKind: 'user', body: 'hi', createdAt: 3 }],
          somethingFromTheFuture: { nested: true },
        }),
      ],
      projects: [{ id: 'p1', name: 'Alpha', createdAt: 1, updatedAt: 1 }],
      unknownTopLevel: ['keep me'],
    });

    const issue = out.issues[0] as Record<string, unknown>;
    assert.deepEqual(issue.assignee, { id: 'me', assignedAt: 5 });
    assert.deepEqual(issue.somethingFromTheFuture, { nested: true });
    assert.equal(Array.isArray(issue.comments), true);
    assert.deepEqual((out as Record<string, unknown>).unknownTopLevel, ['keep me']);
    assert.equal((out as { projects?: unknown[] }).projects?.length, 1);
  });

  test('a v1 or v2 file still migrates cleanly', () => {
    for (const version of [1, 2]) {
      const out = validateIssuesState({
        version,
        nextId: 3,
        issues: [card('ISS-1'), card('ISS-2')],
      });
      assert.equal(out.issues.length, 2, `v${version} issues must survive`);
      assert.equal(out.schemaRevision, ISSUES_SCHEMA_VERSION, `v${version} must be upgraded`);
      assert.equal(out.nextId, 3);
    }
  });

  test('only a blob with no issues array resets to empty', () => {
    assert.deepEqual(validateIssuesState(null).issues, []);
    assert.deepEqual(validateIssuesState({ version: 2 }).issues, []);
    assert.deepEqual(validateIssuesState({ version: 2, issues: 'nope' }).issues, []);
  });

  test('a version-less blob with issues is still read', () => {
    const out = validateIssuesState({ issues: [card('MIN-9')] });
    assert.equal(out.issues.length, 1);
    assert.equal(out.schemaRevision, ISSUES_SCHEMA_VERSION);
  });

  test('links, refs and counters are preserved through validation', () => {
    const out = validateIssuesState({
      version: 2,
      nextId: 1,
      issues: [
        card('MIN-1', {
          codeRefs: [{ path: 'src/a.ts', startLine: 3 }],
          gitLinks: [{ kind: 'pr', ref: '412', addedAt: 1 }],
          issueRefs: [{ issueId: 'MIN-2', kind: 'blocks', addedAt: 1 }],
          chatIds: ['chat-1'],
          planPath: 'documentation/plans/issues/MIN-1.md',
        }),
      ],
      workspaces: { '/repo': { projectKey: 'MIN', nextId: 2 } },
    });

    const issue = out.issues[0] as Record<string, unknown>;
    assert.equal((issue.codeRefs as unknown[]).length, 1);
    assert.equal((issue.gitLinks as unknown[]).length, 1);
    assert.equal((issue.issueRefs as unknown[]).length, 1, 'issueRefs must not be dropped');
    assert.deepEqual(issue.chatIds, ['chat-1']);
    assert.equal(issue.planPath, 'documentation/plans/issues/MIN-1.md');
    assert.deepEqual(out.workspaces['/repo'], { projectKey: 'MIN', nextId: 2 });
  });
});

describe('issues client parser forward compatibility', () => {
  test('mirrors the server: newer revisions are read and written back intact', async () => {
    const { parseIssuesState } = await import('../../src/state/issues-store.ts');

    const out = parseIssuesState({
      version: ISSUES_COMPAT_VERSION,
      schemaRevision: ISSUES_SCHEMA_VERSION + 4,
      nextId: 2,
      issues: [
        card('MIN-1', { rank: 'a0', parentId: 'MIN-0', fromTheFuture: 1 }),
      ],
      workspaces: { '/repo': { projectKey: 'MIN', nextId: 2 } },
      views: [{ id: 'triage', name: 'Triage', filters: {}, order: 0, builtIn: true }],
    });

    assert.equal(out.issues.length, 1);
    assert.equal(out.schemaRevision, ISSUES_SCHEMA_VERSION + 4, 'never downgrade the file');
    const issue = out.issues[0] as unknown as Record<string, unknown>;
    assert.equal(issue.rank, 'a0');
    assert.equal(issue.parentId, 'MIN-0');
    assert.equal(issue.fromTheFuture, 1, 'unmodelled card fields survive');
    assert.equal((out as { views?: unknown[] }).views?.length, 1);
  });

  test('mirrors the server: only a missing issues array resets to empty', async () => {
    const { parseIssuesState } = await import('../../src/state/issues-store.ts');
    assert.deepEqual(parseIssuesState({ schemaRevision: 99 }).issues, []);
    assert.equal(
      parseIssuesState({ schemaRevision: 99, issues: [card('MIN-1')] }).issues.length,
      1,
    );
  });
});

describe('issues schema backup before a revision change', () => {
  const homes: string[] = [];
  const previousHome = process.env.MINNOW_HOME;

  afterEach(async () => {
    for (const dir of homes.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    if (previousHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = previousHome;
  });

  async function makeHome(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-issues-backup-'));
    homes.push(dir);
    process.env.MINNOW_HOME = dir;
    return dir;
  }

  test('an existing state.json is copied aside before its revision changes', async () => {
    const home = await makeHome();
    const { writeResource } = await import('../../server/config/store.js');

    await fs.mkdir(path.join(home, 'issues'), { recursive: true });
    const before = {
      version: 2,
      nextId: 2,
      issues: [card('MIN-1')],
      workspaces: {},
    };
    await fs.writeFile(
      path.join(home, 'issues', 'state.json'),
      JSON.stringify(before, null, 2),
      'utf8',
    );

    await writeResource('issues', {
      version: ISSUES_COMPAT_VERSION,
      schemaRevision: ISSUES_SCHEMA_VERSION,
      nextId: 2,
      issues: [card('MIN-1'), card('MIN-2')],
      workspaces: {},
    });

    const backups = await fs.readdir(path.join(home, 'issues', 'backups'));
    assert.equal(backups.length, 1, 'exactly one backup for one revision change');
    assert.match(backups[0], /^state\.v2\.\d+\.json$/);

    const restored = JSON.parse(
      await fs.readFile(path.join(home, 'issues', 'backups', backups[0]), 'utf8'),
    );
    assert.deepEqual(restored, before, 'the backup is the pre-migration bytes');

    const live = JSON.parse(
      await fs.readFile(path.join(home, 'issues', 'state.json'), 'utf8'),
    );
    assert.equal(live.issues.length, 2);
    assert.equal(live.version, ISSUES_COMPAT_VERSION);
    assert.equal(live.schemaRevision, ISSUES_SCHEMA_VERSION);
  });

  test('same-revision writes do not accumulate backups', async () => {
    const home = await makeHome();
    const { writeResource } = await import('../../server/config/store.js');

    const state = {
      version: ISSUES_COMPAT_VERSION,
      schemaRevision: ISSUES_SCHEMA_VERSION,
      nextId: 2,
      issues: [card('MIN-1')],
      workspaces: {},
    };
    await writeResource('issues', state);
    await writeResource('issues', state);
    await writeResource('issues', state);

    const dir = path.join(home, 'issues', 'backups');
    const backups = await fs.readdir(dir).catch(() => []);
    assert.equal(backups.length, 0, 'steady-state saves must not write backups');
  });
});
