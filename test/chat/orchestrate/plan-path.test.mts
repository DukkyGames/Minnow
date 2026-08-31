/**
 * Effective orchestrate plan path resolution and picker listing rules.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  isExecutableOrchestratePlan,
  isOrchestratePlanPickerEntry,
  isSuperPlanReferenceArtifactBasename,
  isTopLevelOrchestratePlan,
  normalizeOrchestratePlanPath,
  resolveEffectiveOrchestratePlanPath,
} from '../../../src/chat/plans/plan-path.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  setSessionStateForTests,
} from '../../../src/state/sessions.ts';
import type { ChatGroup } from '../../../src/types.ts';

const PLAN = 'documentation/plans/feature.md';
const NESTED = 'documentation/plans/nested/step.md';
const SPEC = 'documentation/plans/my-feature-spec.md';

afterEach(() => {
  flushScheduledSessionSaveForTests();
  setSessionStateForTests(null);
});

describe('resolveEffectiveOrchestratePlanPath', () => {
  test('prefers chat path then group then board store', () => {
    const chat = createEmptyChatObject('');
    chat.orchestratePlanPath = PLAN;
    const group = {
      id: 'grp_1',
      name: 'Board',
      workspacePath: '',
      orchestratePlanPath: 'documentation/plans/other.md',
      orchestrateBoard: {
        planPath: 'documentation/plans/board.md',
        tasks: [],
        waves: [],
        startedAt: 1,
        lastUpdatedAt: 1,
      },
    } as ChatGroup;
    assert.equal(resolveEffectiveOrchestratePlanPath(chat, group), PLAN);
  });
});

describe('executable orchestrate plans', () => {
  test('accepts markdown under documentation/plans root', () => {
    assert.equal(isExecutableOrchestratePlan('documentation/plans/feature-foo.md'), true);
    assert.equal(
      normalizeOrchestratePlanPath('documentation/plans/feature-foo.md'),
      'documentation/plans/feature-foo.md',
    );
  });

  test('accepts nested dirs outside references and verification', () => {
    assert.equal(isExecutableOrchestratePlan('documentation/plans/Build out/step-01.md'), true);
  });

  test('rejects references subtree', () => {
    assert.equal(
      isExecutableOrchestratePlan('documentation/plans/references/mode-sources.md'),
      false,
    );
    assert.equal(
      normalizeOrchestratePlanPath('documentation/plans/references/mode-sources.md'),
      undefined,
    );
  });

  test('rejects verification subtree', () => {
    assert.equal(
      isExecutableOrchestratePlan('documentation/plans/verification/step-05.md'),
      false,
    );
  });

  test('rejects paths outside documentation/plans', () => {
    assert.equal(isExecutableOrchestratePlan('src/main.ts'), false);
    assert.equal(isExecutableOrchestratePlan('plans/foo.md'), false);
  });
});

describe('orchestrate plan picker entries', () => {
  test('top-level executable plans are listed', () => {
    assert.equal(isOrchestratePlanPickerEntry(PLAN), true);
    assert.equal(isOrchestratePlanPickerEntry('documentation/plans/run.md'), true);
  });

  test('nested dirs and Super Plan research artifacts are not picker rows', () => {
    assert.equal(isOrchestratePlanPickerEntry('documentation/plans/waves/foo.md'), false);
    assert.equal(isOrchestratePlanPickerEntry('documentation/plans/run-research.md'), false);
  });

  test('nested executable paths are not default picker rows', () => {
    assert.equal(isTopLevelOrchestratePlan(NESTED), false);
    assert.equal(isOrchestratePlanPickerEntry(NESTED), false);
  });

  test('super plan reference basenames are excluded', () => {
    assert.equal(isSuperPlanReferenceArtifactBasename(SPEC), true);
    assert.equal(isOrchestratePlanPickerEntry(SPEC), false);
  });
});
