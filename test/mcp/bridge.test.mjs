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

  test('snake_case tool names survive the parse', () => {
    const name = toNamespacedName('playwright', 'browser_navigate');
    assert.equal(name, 'mcp__playwright__browser_navigate');
    const parsed = parseNamespacedName(name);
    assert.equal(parsed.serverId, 'playwright');
    assert.equal(parsed.toolName, 'browser_navigate');
    assert.deepEqual(parsed.toolNameCandidates, [
      'browser_navigate',
      'browser-navigate',
    ]);
  });

  test('dashed tool names stay reachable through the candidate list', () => {
    const parsed = parseNamespacedName(
      toNamespacedName('context7', 'resolve-library-id'),
    );
    assert.ok(parsed.toolNameCandidates.includes('resolve-library-id'));
  });

  test('server ids keep hyphens', () => {
    const parsed = parseNamespacedName(
      toNamespacedName('playwright-mcp', 'browser_click'),
    );
    assert.equal(parsed.serverId, 'playwright-mcp');
    assert.equal(parsed.toolName, 'browser_click');
  });

  test('non-MCP names parse to null', () => {
    assert.equal(parseNamespacedName('plugin__x__y'), null);
    assert.equal(parseNamespacedName('mcp__only'), null);
  });
});
