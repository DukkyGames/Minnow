/**
 * Capability-matrix workspace fixture seeding (mocked tool execution).
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

type ToolCall = { name: string; args: Record<string, unknown> };

const toolCalls: ToolCall[] = [];

mock.module('../../src/benchmark/execute-tool-sandbox.ts', {
  namedExports: {
    executeBenchmarkTool: async (name: string, args: Record<string, unknown>) => {
      toolCalls.push({ name, args });
      if (name === 'read_file' && String(args.path).includes('.git/HEAD')) {
        return { content: 'ref: refs/heads/main\n' };
      }
      return { content: 'ok' };
    },
    createBenchmarkExecuteToolFn: () => async () => ({ content: 'ok' }),
    isBenchmarkStubbedTool: () => false,
  },
});

const {
  CAP_MATRIX_JSON_PATH,
  CAP_MATRIX_NOTES_PATH,
  CAP_MATRIX_REPO_DIR,
  CAP_MATRIX_SAMPLE_PATH,
  CAP_MATRIX_GREP_TOKEN,
  CAPABILITY_MATRIX_FIXTURE_DIR,
  CAPABILITY_FIXTURE_PROBE_PROMPTS,
  PHASE_2C_WORKSPACE_CAPABILITY_IDS,
  PHASE_2E_FIXTURE_PROBE_PROMPTS,
  seedCapabilityMatrixFixtures,
  isCapabilityMatrixGitFixtureReady,
} = await import('../../src/benchmark/capabilities/fixtures-workspace.ts');

describe('capability matrix fixtures-workspace', () => {
  test('phase 2c id list covers 14 workspace bands', () => {
    assert.equal(PHASE_2C_WORKSPACE_CAPABILITY_IDS.length, 14);
    assert.equal(Object.keys(CAPABILITY_FIXTURE_PROBE_PROMPTS).length, 14);
    for (const id of PHASE_2C_WORKSPACE_CAPABILITY_IDS) {
      const prompt = CAPABILITY_FIXTURE_PROBE_PROMPTS[id];
      assert.ok(prompt, id);
      assert.ok(!prompt.includes('BUILT_IN_TOOLS'), id);
      assert.ok(!prompt.includes('package.json'), id);
      assert.ok(
        prompt.includes(CAPABILITY_MATRIX_FIXTURE_DIR) ||
          prompt.includes('run_python') ||
          prompt.includes('node'),
        id,
      );
    }
  });

  test('phase 2e fixture prompts cover conditional workspace/LSP probes', () => {
    assert.equal(Object.keys(PHASE_2E_FIXTURE_PROBE_PROMPTS).length, 4);
    for (const id of Object.keys(PHASE_2E_FIXTURE_PROBE_PROMPTS)) {
      const prompt = PHASE_2E_FIXTURE_PROBE_PROMPTS[id];
      assert.ok(prompt.length >= 24, id);
      assert.ok(!prompt.includes('BUILT_IN_TOOLS'), id);
    }
  });

  test('seedCapabilityMatrixFixtures writes matrix tree and git repo', async () => {
    toolCalls.length = 0;
    const root = '/tmp/fake-bench-workspace';
    await seedCapabilityMatrixFixtures(root);

    assert.ok(
      toolCalls.some(
        (c) => c.name === 'delete_path' && c.args.path === CAPABILITY_MATRIX_FIXTURE_DIR,
      ),
    );
    assert.ok(
      toolCalls.some((c) => c.name === 'save_file' && c.args.path === CAP_MATRIX_JSON_PATH),
    );
    assert.ok(
      toolCalls.some((c) => c.name === 'save_file' && c.args.path === CAP_MATRIX_NOTES_PATH),
    );
    assert.ok(
      toolCalls.some((c) => c.name === 'save_file' && c.args.path === CAP_MATRIX_SAMPLE_PATH),
    );
    assert.ok(toolCalls.some((c) => c.name === 'create_pdf'));
    assert.ok(
      toolCalls.some(
        (c) =>
          c.name === 'execute_command' &&
          String(c.args.command).includes('git init') &&
          c.args.cwd === CAP_MATRIX_REPO_DIR,
      ),
    );
    const haystackSave = toolCalls.find((c) => c.name === 'save_file' && String(c.args.path).includes('haystack'));
    assert.ok(haystackSave);
    assert.ok(String(haystackSave?.args.content).includes(CAP_MATRIX_GREP_TOKEN));

    assert.equal(await isCapabilityMatrixGitFixtureReady(root), true);
  });
});
