/**
 * v3 field writes keep compatibility `version` at 2.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  addIssue,
  addIssueProject,
  getIssuesSnapshot,
  parseIssuesState,
  queueIssueAgent,
  setIssuesNowForTests,
  setIssuesStateForTests,
  updateIssue,
} from '../../src/state/issues-store.ts';
import {
  ISSUES_COMPAT_VERSION,
  ISSUES_SCHEMA_VERSION,
} from '../../src/types.ts';
import { validateIssuesState } from '../../server/config/validators.js';

const FIXED_NOW = 1_710_000_006_000;

describe('issues v3 field writes', () => {
  beforeEach(() => {
    setIssuesNowForTests(() => FIXED_NOW);
    setIssuesStateForTests({
      version: ISSUES_COMPAT_VERSION,
      schemaRevision: ISSUES_SCHEMA_VERSION,
      nextId: 1,
      issues: [],
      workspaces: {},
    });
  });

  test('addIssue and updateIssue persist v3 fields without writing version 3', () => {
    const project = addIssueProject('Alpha');
    const parent = addIssue({ title: 'Parent', workspacePath: '/w' }, 'ISS-1');
    const child = addIssue(
      {
        title: 'Child',
        workspacePath: '/w',
        parentId: 'ISS-1',
        projectId: project.id,
        source: 'user',
      },
      'ISS-2',
    );
    updateIssue('ISS-1', {
      assignee: { id: 'me', label: 'Me', assignedAt: FIXED_NOW },
      rank: 'm',
    });
    queueIssueAgent('ISS-1', 'builder');

    const snap = getIssuesSnapshot();
    assert.equal(snap.version, ISSUES_COMPAT_VERSION);
    assert.equal(snap.schemaRevision, ISSUES_SCHEMA_VERSION);
    assert.equal(parent.status, 'backlog');
    assert.equal(child.parentId, 'ISS-1');
    assert.equal(child.projectId, project.id);
    const storedParent = snap.issues.find((issue) => issue.id === 'ISS-1');
    assert.equal(storedParent?.assignee?.id, 'me');
    assert.equal(storedParent?.agent?.phase, 'queued');
    assert.equal(storedParent?.rank, 'm');
  });

  test('an invalid parent link is rejected', () => {
    addIssue({ title: 'Parent', workspacePath: '/w' }, 'ISS-1');
    addIssue({ title: 'Child', workspacePath: '/w', parentId: 'ISS-1' }, 'ISS-2');
    assert.throws(() => updateIssue('ISS-1', { parentId: 'ISS-2' }));
  });

  test('client and server parsers keep version at 2 while reading v3 fields', () => {
    const raw = {
      version: 2,
      schemaRevision: 3,
      nextId: 3,
      issues: [
        {
          id: 'ISS-1',
          type: 'task',
          title: 'Filed',
          description: '',
          status: 'backlog',
          priority: 'none',
          labels: [],
          workspacePath: '/w',
          createdAt: 1,
          updatedAt: 1,
          source: 'crash',
          rank: 'a',
          extraFuture: true,
        },
      ],
    };
    const client = parseIssuesState(raw);
    const server = validateIssuesState(raw);
    assert.equal(client.version, ISSUES_COMPAT_VERSION);
    assert.equal(server.version, ISSUES_COMPAT_VERSION);
    assert.equal(client.issues[0].source, 'crash');
    assert.equal(client.issues[0].rank, 'a');
    assert.equal((client.issues[0] as { extraFuture?: boolean }).extraFuture, true);
    assert.equal(server.issues[0].source, 'crash');
  });
});
