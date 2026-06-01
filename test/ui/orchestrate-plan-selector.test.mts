import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { shouldMountOrchestratePlanInInputRow } from '../../src/ui/orchestrate-plan-selector.ts';

describe('shouldMountOrchestratePlanInInputRow', () => {
  test('false outside Orchestrate mode', () => {
    assert.equal(
      shouldMountOrchestratePlanInInputRow({ modeId: 'build' }),
      false,
    );
  });

  test('false when board onboarding owns plan pick', () => {
    assert.equal(
      shouldMountOrchestratePlanInInputRow({
        modeId: 'orchestrate',
        viewMode: 'board',
        orchestrateBoard: undefined,
      }),
      false,
    );
  });

  test('true for Orchestrate chat view with composer plan strip', () => {
    assert.equal(
      shouldMountOrchestratePlanInInputRow({
        modeId: 'orchestrate',
        viewMode: 'chat',
        orchestrateBoard: { columns: [] },
      }),
      true,
    );
  });
});
