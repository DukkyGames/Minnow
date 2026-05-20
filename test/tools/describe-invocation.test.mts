/**
 * Tests for tool invocation summaries used in the approval modal.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeToolInvocation } from '../../src/tools/describe-invocation.ts';

describe('describeToolInvocation', () => {
  test('returns catalog label, tool id, description, and JSON args', () => {
    const r = describeToolInvocation('list_directory', { path: '.' });
    assert.equal(r.title, 'List directory');
    assert.equal(r.toolId, 'list_directory');
    assert.ok(r.description && r.description.length > 0);
    assert.ok(r.argsJson.includes('"path"'));
    assert.ok(r.argsJson.includes('.'));
  });

  test('falls back to tool id as title when unknown', () => {
    const r = describeToolInvocation('unknown_tool_xyz', { a: 1 });
    assert.equal(r.title, 'unknown_tool_xyz');
    assert.equal(r.toolId, 'unknown_tool_xyz');
    assert.equal(r.description, undefined);
  });
});
