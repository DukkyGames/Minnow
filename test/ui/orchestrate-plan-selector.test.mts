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

  test('false in Orchestrate board view (plan strip lives in toolbar, not input row)', () => {
    assert.equal(
      shouldMountOrchestratePlanInInputRow({
        modeId: 'orchestrate',
        viewMode: 'board',
        orchestrateBoard: undefined,
      }),
      false,
    );
  });

  test('false in Orchestrate chat view (textarea stays visible for direct chatting)', () => {
    assert.equal(
      shouldMountOrchestratePlanInInputRow({
        modeId: 'orchestrate',
        viewMode: 'chat',
        orchestrateBoard: { columns: [] },
      }),
      false,
    );
  });
});
