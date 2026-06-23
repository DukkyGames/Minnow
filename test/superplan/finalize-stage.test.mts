import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  foldUiGuidanceIntoPlan,
  resolveReviseTarget,
} from '../../src/superplan/helpers.ts';
import { buildSuperPlanPath, slugifySuperPlanTitle } from '../../src/superplan/plan-slug.ts';
import { isExecutableOrchestratePlan } from '../../src/chat/orchestrate/plan-path.ts';

describe('superplan finalize helpers', () => {
  test('slugifySuperPlanTitle produces kebab slugs', () => {
    assert.equal(slugifySuperPlanTitle('Widget Refresh v2!'), 'widget-refresh-v2');
  });

  test('buildSuperPlanPath is an executable orchestrate plan', () => {
    const path = buildSuperPlanPath('Widget Refresh');
    assert.equal(path, 'documentation/plans/superplan-widget-refresh.md');
    assert.equal(isExecutableOrchestratePlan(path), true);
  });

  test('foldUiGuidanceIntoPlan appends guidance section once', () => {
    const merged = foldUiGuidanceIntoPlan('# Plan\n\nBody', 'Use --mn-* tokens.');
    assert.match(merged, /## UI design guidance/);
    assert.match(merged, /--mn-\*/);
    const again = foldUiGuidanceIntoPlan(merged, 'ignored');
    assert.equal(again.trim(), merged.trim());
  });

  test('resolveReviseTarget picks spec when notes mention specification', () => {
    assert.equal(resolveReviseTarget('Please revise the specification'), 'spec');
    assert.equal(resolveReviseTarget('More detail on W2'), 'draft');
  });
});
