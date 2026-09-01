/**
 * P8-G — spawn / cancel / wait against the SSE store (V2 surface).
 *
 * Ports controller cancel AbortError + spawn POST semantics. Concurrency
 * caps and delivery-once live in conformance / delivery tests; retry-on-crash
 * is policy.test.mjs.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  adoptSubAgentRunForTests,
  cancelSubAgent,
  resetSubAgentOrchestrator,
  setSubAgentApiFetchForTests,
  setSubAgentOpenStreamForTests,
  spawnSubAgent,
  waitForSubAgent,
} from '../../src/agents/orchestrator.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';
import { FIXED_RUN_ID, FIXED_SUMMARY } from './test-helpers.mts';

const CHAT_ID = '11111111-1111-1111-1111-222222222222';

function runningRun(): SubAgentRun {
  return {
    runId: FIXED_RUN_ID,
    type: 'explore',
    task: 'scan',
    status: 'running',
    parentChatId: CHAT_ID,
    parentToolCallId: null,
    parentTurnId: 'turn-1',
    summary: '',
    error: null,
    startedAt: '2026-05-19T12:00:00.000Z',
    endedAt: null,
    toolTurns: 0,
    cancelled: false,
    messages: [],
  };
}

describe('orchestrator SSE store (spawn / cancel / wait)', () => {
  const posts: Array<{ method: string; url: string; body: string }> = [];

  beforeEach(() => {
    posts.length = 0;
    resetSubAgentOrchestrator();
    setSubAgentOpenStreamForTests(() => ({ addEventListener() {}, close() {} }));
    setSubAgentApiFetchForTests(async (input, init) => {
      const method = init?.method ?? 'GET';
      const url = String(input);
      posts.push({ method, url, body: String(init?.body ?? '') });
      if (method === 'POST' && url.endsWith('/api/agents') && !url.includes('/cancel')) {
        return new Response(
          JSON.stringify({
            ok: true,
            runId: FIXED_RUN_ID,
            status: 'running',
            run: {
              runId: FIXED_RUN_ID,
              type: 'explore',
              task: 'scan',
              parentChatId: CHAT_ID,
              parentTurnId: 'turn-1',
              cwd: '/tmp',
              requestedAt: 1,
              phase: 'running',
              attempts: [],
              delivered: false,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url.includes('/cancel')) {
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'cancelled',
            state: {
              runs: [
                {
                  runId: FIXED_RUN_ID,
                  type: 'explore',
                  task: 'scan',
                  parentChatId: CHAT_ID,
                  phase: 'cancelled',
                  attempts: [],
                  delivered: false,
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${method} ${url}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    setSubAgentApiFetchForTests(null);
    setSubAgentOpenStreamForTests(null);
    resetSubAgentOrchestrator();
  });

  test('spawn POSTs /api/agents and adopts the returned run', async () => {
    const result = await spawnSubAgent({
      type: 'explore',
      task: 'scan',
      wait: false,
      parentChatId: CHAT_ID,
      parentTurnId: 'turn-1',
    });
    assert.equal(result.runId, FIXED_RUN_ID);
    if (!('status' in result)) assert.fail('expected spawn result');
    assert.equal(result.status, 'running');
    const spawn = posts.find((p) => p.method === 'POST' && p.url.endsWith('/api/agents'));
    assert.ok(spawn);
    const body = JSON.parse(spawn.body) as { type: string; task: string; parentChatId: string };
    assert.equal(body.type, 'explore');
    assert.equal(body.task, 'scan');
    assert.equal(body.parentChatId, CHAT_ID);
  });

  test('cancel POSTs /api/agents/:runId/cancel', async () => {
    adoptSubAgentRunForTests(runningRun());
    const result = cancelSubAgent(FIXED_RUN_ID, 'user_cancel');
    assert.equal(result.ok, true);
    assert.equal(result.runId, FIXED_RUN_ID);
    await new Promise((r) => setTimeout(r, 20));
    const cancel = posts.find((p) => p.url.includes(`/${FIXED_RUN_ID}/cancel`));
    assert.ok(cancel);
    assert.equal(cancel.method, 'POST');
  });

  test('waitForSubAgent rejects AbortError and POSTs cancel', async () => {
    adoptSubAgentRunForTests(runningRun());
    const ac = new AbortController();
    const pending = waitForSubAgent(FIXED_RUN_ID, ac.signal);
    ac.abort();
    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err && typeof err === 'object' && 'name' in err);
      assert.equal((err as { name: string }).name, 'AbortError');
      return true;
    });
    await new Promise((r) => setTimeout(r, 20));
    const cancel = posts.find((p) => p.url.includes(`/${FIXED_RUN_ID}/cancel`));
    assert.ok(cancel);
  });

  test('waitForSubAgent resolves when the store already has a terminal run', async () => {
    adoptSubAgentRunForTests({
      ...runningRun(),
      status: 'completed',
      summary: FIXED_SUMMARY,
      endedAt: '2026-05-19T12:00:01.000Z',
      structuredOutcome: {
        summary: FIXED_SUMMARY,
        findings: [],
        artifacts: [],
      },
    });
    const agg = await waitForSubAgent(FIXED_RUN_ID);
    assert.equal(agg.status, 'completed');
    assert.equal(agg.summary, FIXED_SUMMARY);
  });
});
