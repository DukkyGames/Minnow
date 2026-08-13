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
  CAP_MATRIX_HAYSTACK_NEEDLE,
  CAPABILITY_MATRIX_FIXTURE_DIR,
  seedCapabilityMatrixFixtures,
  isCapabilityMatrixGitFixtureReady,
} = await import('../../src/benchmark/capabilities/fixtures-workspace.ts');

const { getCapabilityProbePrompt } = await import(
  '../../src/benchmark/capabilities/probe-prompts.ts'
);
const { PHASE_2C_WORKSPACE_CAPABILITY_IDS } = await import(
  '../../src/benchmark/capabilities/probe-wave-ids.ts'
);

describe('capability matrix fixtures-workspace', () => {
  test('phase 2c workspace probes prompt against seeded fixtures', () => {
    assert.equal(PHASE_2C_WORKSPACE_CAPABILITY_IDS.length, 14);
    for (const id of PHASE_2C_WORKSPACE_CAPABILITY_IDS) {
      const prompt = getCapabilityProbePrompt(id);
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
          c.args.cwd === undefined,
      ),
    );
    const haystackSave = toolCalls.find((c) => c.name === 'save_file' && String(c.args.path).includes('haystack'));
    assert.ok(haystackSave);
    const haystack = String(haystackSave?.args.content);
    assert.ok(haystack.includes(CAP_MATRIX_GREP_TOKEN));
    // The needle must sit mid-file, not on line 1 where a head-only read would find it.
    const needleLine = haystack.split('\n').findIndex((l) => l.includes(CAP_MATRIX_HAYSTACK_NEEDLE));
    assert.ok(needleLine > 10, `needle too near the head (line ${needleLine})`);

    assert.equal(await isCapabilityMatrixGitFixtureReady(root), true);
  });
});
