import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONCIERGE_LINES, routeIntent } from '../../src/os/intent-routing.ts';

describe('routeIntent', () => {
  test('routes bug hunts to code', () => {
    assert.equal(routeIntent('Find bugs in my finance app'), 'code');
    assert.equal(routeIntent('look for issues in the repo'), 'code');
  });

  test('routes coding intents to code', () => {
    assert.equal(routeIntent('help me refactor this component'), 'code');
    assert.equal(routeIntent('fix the dev server'), 'code');
  });

  test('routes research intents to research', () => {
    assert.equal(routeIntent('deep dive into sources'), 'research');
    assert.equal(routeIntent('investigate this topic'), 'research');
  });

  test('routes expert intents to experts', () => {
    assert.equal(routeIntent('design an expert persona'), 'experts');
    assert.equal(routeIntent('run eval harness'), 'experts');
  });

  test('routes benchmark intents to bench', () => {
    assert.equal(routeIntent('compare models for throughput'), 'bench');
    assert.equal(routeIntent('measure tok/s'), 'bench');
  });

  test('routes settings intents to settings', () => {
    assert.equal(routeIntent('change theme to dark'), 'settings');
    assert.equal(routeIntent('update api key'), 'settings');
  });

  test('routes conversational intents to chat', () => {
    assert.equal(routeIntent('tell me a story'), 'chat');
    assert.equal(routeIntent('what is recursion'), 'chat');
  });

  test('defaults to chat for empty or unknown input', () => {
    assert.equal(routeIntent(''), 'chat');
    assert.equal(routeIntent('   '), 'chat');
    assert.equal(routeIntent('xyzzy'), 'chat');
  });

  test('uses first matching rule in priority order', () => {
    assert.equal(routeIntent('build a benchmark harness'), 'code');
    assert.equal(routeIntent('research settings providers'), 'research');
  });
});

describe('CONCIERGE_LINES', () => {
  test('exports non-empty whimsical status lines', () => {
    assert.ok(CONCIERGE_LINES.length >= 3);
    for (const line of CONCIERGE_LINES) {
      assert.ok(line.length > 0);
    }
  });
});
