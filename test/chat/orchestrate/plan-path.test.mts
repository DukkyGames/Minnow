/**
 * Effective orchestrate plan path resolution and picker listing rules.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  isOrchestratePlanPickerEntry,
  isSuperPlanReferenceArtifactBasename,
  isTopLevelOrchestratePlan,
  resolveEffectiveOrchestratePlanPath,
} from '../../../src/chat/orchestrate/plan-path.ts';
import { resolveEffectiveOrchestratePlanPathWithSync } from '../../../src/chat/orchestrate/plan-path-sync.ts';
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

  test('sync copies group path onto chat when chat is empty', () => {
    const chat = createEmptyChatObject('');
    chat.id = '11111111-1111-1111-1111-111111111111';
    const group = {
      id: 'grp_2',
      name: 'Board',
      workspacePath: '',
      orchestratePlanPath: PLAN,
    } as ChatGroup;
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      groups: [group],
      chats: [chat],
    });
    assert.equal(
      resolveEffectiveOrchestratePlanPathWithSync(chat, group, { sync: true }),
      PLAN,
    );
    assert.equal(chat.orchestratePlanPath, PLAN);
  });
});

describe('orchestrate plan picker entries', () => {
  test('top-level executable plans are listed', () => {
    assert.equal(isOrchestratePlanPickerEntry(PLAN), true);
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
