/**
 * Brain cleanup execute — plan load + agent loop (mocked LLM).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { getCleanupPlansDir, loadCleanupPlan, saveCleanupPlan } from '../../server/brain/cleanup/persist.js';
import {
  executeBrainCleanup,
  executeCleanupDeps,
  MAX_CLEANUP_TOOL_ROUNDS,
} from '../../server/brain/cleanup/execute.js';
import { ensureBrainStore, createPage } from '../../server/brain/store.js';
import { closeCodeDbForTests } from '../../server/brain/code/schema.js';

const PLAN_ID = '11111111-1111-1111-1111-111111111111';

function completionWithToolCalls(toolCalls, content = '') {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content,
          tool_calls: toolCalls,
        },
      },
    ],
  };
}

function completionText(text) {
  return {
    choices: [
      {
        finish_reason: 'stop',
        message: { role: 'assistant', content: text },
      },
    ],
  };
}

describe('brain cleanup execute', () => {
  let homeDir;
  /** @type {typeof fetch} */
  let originalFetch;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-cleanup-exec-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await ensureBrainStore();
    await saveCleanupPlan({
      planId: PLAN_ID,
      planVersion: 1,
      createdAt: '2026-08-07T00:00:00.000Z',
      planMarkdown: '## Plan\n- Delete orphan page facts/orphan.md',
      summary: { deletes: 1 },
    });
    originalFetch = executeCleanupDeps.fetchFn;
    executeCleanupDeps.getProviderRuntime = async () => ({
      profile: { baseUrl: 'http://127.0.0.1:9' },
      paths: { chatCompletionsPath: '/v1/chat/completions' },
      headers: { Authorization: 'Bearer test' },
    });
  });

  after(async () => {
    executeCleanupDeps.fetchFn = originalFetch;
    closeCodeDbForTests();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('loadCleanupPlan reads planMarkdown from persisted file', async () => {
    const plan = await loadCleanupPlan(PLAN_ID);
    assert.equal(plan.planId, PLAN_ID);
    assert.match(plan.planMarkdown, /Delete orphan/);
    const onDisk = path.join(getCleanupPlansDir(), `${PLAN_ID}.json`);
    assert.ok((await fs.stat(onDisk)).isFile());
  });

  test('execute rejects missing plan', async () => {
    await assert.rejects(
      () =>
        executeBrainCleanup({
          planId: '00000000-0000-0000-0000-000000000099',
          providerId: 'local',
          modelId: 'fake',
        }),
      /not found/i,
    );
  });

  test('execute runs tool loop and completes via cleanup_complete', async () => {
    await createPage({
      relPath: 'facts/orphan.md',
      title: 'Orphan',
      body: 'Orphan body.',
      source: 'user',
    });

    let call = 0;
    executeCleanupDeps.fetchFn = async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify(
            completionWithToolCalls([
              {
                id: 'call-delete-1',
                type: 'function',
                function: {
                  name: 'manage_brain',
                  arguments: JSON.stringify({
                    action: 'delete_page',
                    path: 'facts/orphan.md',
                  }),
                },
              },
            ]),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify(
          completionWithToolCalls([
            {
              id: 'call-done-1',
              type: 'function',
              function: {
                name: 'cleanup_complete',
                arguments: JSON.stringify({ summary: 'Deleted orphan page.' }),
              },
            },
          ]),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const outcome = await executeBrainCleanup({
      planId: PLAN_ID,
      providerId: 'local',
      modelId: 'fake-model',
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.result.summary, 'Deleted orphan page.');
    assert.ok(outcome.log.some((row) => row.tool === 'manage_brain' && row.path === 'facts/orphan.md'));

    await assert.rejects(() => fs.stat(path.join(homeDir, 'brain', 'pages', 'facts', 'orphan.md')));
  });

  test('manage_brain blocks non-delete actions', async () => {
    let call = 0;
    executeCleanupDeps.fetchFn = async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify(
            completionWithToolCalls([
              {
                id: 'call-bad-1',
                type: 'function',
                function: {
                  name: 'manage_brain',
                  arguments: JSON.stringify({ action: 'clear_wiki' }),
                },
              },
            ]),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(completionText('done')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const outcome = await executeBrainCleanup({
      planId: PLAN_ID,
      providerId: 'local',
      modelId: 'fake-model',
    });

    const toolMsg = outcome.log.find((row) => row.tool === 'manage_brain');
    assert.ok(toolMsg);
    assert.equal(outcome.status, 'completed');
  });

  test('stops after max tool rounds', async () => {
    executeCleanupDeps.fetchFn = async () =>
      new Response(
        JSON.stringify(
          completionWithToolCalls([
            {
              id: 'call-list',
              type: 'function',
              function: { name: 'brain_list', arguments: '{}' },
            },
          ]),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const outcome = await executeBrainCleanup({
      planId: PLAN_ID,
      providerId: 'local',
      modelId: 'fake-model',
    });

    assert.equal(outcome.status, 'stopped');
    assert.equal(outcome.result.rounds, MAX_CLEANUP_TOOL_ROUNDS);
  });
});
