import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  toNamespacedName,
  parseNamespacedName,
} from '../../server/mcp/bridge.js';

describe('MCP bridge', () => {
  test('namespacing round-trip', () => {
    const name = toNamespacedName('fixture', 'echo');
    assert.equal(name, 'mcp__fixture__echo');
    const parsed = parseNamespacedName(name);
    assert.equal(parsed.serverId, 'fixture');
    assert.equal(parsed.toolName, 'echo');
  });
});
