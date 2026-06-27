/**
 * Finish dashboard report: deterministic sections and recommendations merge.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildDeterministicFinishReport,
  FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER,
  mergeFinishReportRecommendations,
} from '../../src/chat/orchestrate/finish-stats.ts';
import {
  buildFinishRecommendationsPrompt,
  sanitizeRecommendationsMarkdown,
} from '../../src/chat/orchestrate/finish-recommendations.ts';
import type { Chat, OrchestrateBoardState } from '../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function makeBoard(overrides: Partial<OrchestrateBoardState> = {}): OrchestrateBoardState {
  return {
    planPath: 'documentation/plans/orchestrator-board-smoke.md',
    startedAt: 1710000000000,
    lastUpdatedAt: 1710003600000,
    waves: [{ id: 'W1', status: 'complete' }],
    tasks: [
      {
        id: 'W1-A',
        title: 'Create greet util',
        wave: 'W1',
        category: 'build',
        status: 'complete',
      },
      {
        id: 'W1-B',
        title: 'Create add util',
        wave: 'W1',
        category: 'build',
        status: 'complete',
      },
    ],
    integrationBranch: 'minnow/board/test/integration',
    finalTest: { status: 'passed' },
    ...overrides,
  };
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Planner',
    workspacePath: '',
    modelId: 'test-model',
    modeId: 'orchestrate',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1710000000000,
    orchestratePlanPath: 'documentation/plans/orchestrator-board-smoke.md',
    ...overrides,
  };
}

describe('buildDeterministicFinishReport', () => {
  test('lists completed tasks under Completed tasks and leaves recommendations as placeholder', () => {
    const report = buildDeterministicFinishReport(makeChat(), makeBoard());

    assert.match(report, /## Completed tasks/);
    assert.match(report, /\*\*W1-A\*\* — Create greet util/);
    assert.match(report, /\*\*W1-B\*\* — Create add util/);
    assert.match(report, /## Recommended next tasks/);
    assert.match(report, new RegExp(FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(report, /## Recommended next tasks[\s\S]*\*\*W1-A\*\*/);
  });
});

describe('mergeFinishReportRecommendations', () => {
  test('replaces the placeholder with LLM bullet output', () => {
    const base = buildDeterministicFinishReport(makeChat(), makeBoard());
    const merged = mergeFinishReportRecommendations(
      base,
      '- Add integration tests for edge cases\n- Document the smoke module',
    );

    assert.match(merged, /- Add integration tests for edge cases/);
    assert.doesNotMatch(merged, new RegExp(FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER));
  });
});

describe('buildFinishRecommendationsPrompt', () => {
  test('includes plan content and completed task ids', () => {
    const messages = buildFinishRecommendationsPrompt(
      '# Smoke plan\n\n## Goal\nExercise the board.',
      makeBoard(),
    );

    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, 'system');
    const user = messages[1]?.content;
    assert.equal(typeof user, 'string');
    assert.match(user as string, /Smoke plan/);
    assert.match(user as string, /W1-A: Create greet util/);
    assert.match(user as string, /do not repeat these/i);
  });
});

describe('sanitizeRecommendationsMarkdown', () => {
  test('normalizes numbered lines and strips fences', () => {
    const raw = '```markdown\n1. Ship docs\n* Run cleanup\n```';
    const cleaned = sanitizeRecommendationsMarkdown(raw);

    assert.equal(
      cleaned,
      '- Ship docs\n- Run cleanup',
    );
  });
});
