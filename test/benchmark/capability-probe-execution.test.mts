/**
 * runCapabilityProbe plumbing: tool resolution, emit-only stubbing, trap-tool stubbing,
 * and tool results reaching the verdict.
 *
 * The driver mock calls the `executeToolFn` the runner hands it, so this exercises the
 * real stub path rather than only the verdict functions.
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import type { OneShotResult } from '../../src/benchmark/llm-driver.ts';
import type { CapabilityRoundTelemetry } from '../../src/benchmark/capabilities/types.ts';
import type { ToolCall } from '../../src/types.ts';
import type { OpenAIFunctionDefinition } from '../../src/tools/definitions.ts';

interface DriverCall {
  messages: { role: string; content: unknown }[];
  tools: OpenAIFunctionDefinition[];
}

let lastDriverCall: DriverCall | null = null;
/** Tool calls the mocked model emits next; each entry becomes one round. */
let scriptedCalls: { name: string; args: Record<string, unknown> }[] = [];
let executedContents: string[] = [];

function baseOneShot(overrides: Partial<OneShotResult> = {}): OneShotResult {
  return {
    text: 'ok',
    contentText: 'ok',
    reasoningText: '',
    toolCalls: [],
    finishReason: 'stop',
    timing: { ttftMs: 5, totalMs: 10, tokPerSec: 50, usage: {}, stats: {}, streamChunkCount: 2 },
    messages: [],
    ...overrides,
  };
}

mock.module('../../src/benchmark/llm-driver.ts', {
  namedExports: {
    runOneShot: async (input: DriverCall) => {
      lastDriverCall = { messages: input.messages, tools: input.tools ?? [] };
      return baseOneShot();
    },
    runToolLoop: async (
      input: DriverCall & {
        onRound?: (round: CapabilityRoundTelemetry) => void;
        executeToolFn: (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ content: string }>;
      },
    ) => {
      lastDriverCall = { messages: input.messages, tools: input.tools ?? [] };
      executedContents = [];
      // The real loop returns only the *last* batch (`preserveLastToolCalls`); the full
      // history lives in the round telemetry. Mirror that, or probes that lose an early
      // call keep passing here while failing in a live run.
      let lastBatch: ToolCall[] = [];
      let round = 0;
      for (const scripted of scriptedCalls) {
        const toolCall: ToolCall = {
          id: `call-${round}`,
          type: 'function',
          function: { name: scripted.name, arguments: JSON.stringify(scripted.args) },
        };
        lastBatch = [toolCall];
        input.onRound?.({ round, toolCalls: [{ function: toolCall.function }] });
        // `runHeadlessToolBatch` turns a throwing tool into a tool message rather than
        // aborting the loop — model that here so probes are scored, not error-failed.
        try {
          const result = await input.executeToolFn(scripted.name, scripted.args);
          executedContents.push(result.content);
        } catch (err) {
          executedContents.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        round += 1;
      }
      return baseOneShot({ toolCalls: lastBatch });
    },
    preserveLastToolCalls: (prev: ToolCall[], next: ToolCall[]) =>
      next.length > 0 ? next : prev,
  },
});

const { getCapabilityById } = await import('../../src/benchmark/capabilities/catalog.ts');
const { runCapabilityProbe } = await import('../../src/benchmark/capabilities/run-probe.ts');
const { CAP_STUB_SNAPSHOT_UIDS, CAP_STUB_THREAD_ID } = await import(
  '../../src/benchmark/capabilities/stub-fixtures.ts'
);

const ctx = {
  providerId: 'fake-provider',
  modelId: 'fake-model',
  localServer: false,
  signal: new AbortController().signal,
};

describe('runCapabilityProbe execution plumbing', () => {
  test('offers exactly the tools the spec declares', async () => {
    scriptedCalls = [];
    const cap = getCapabilityById('browser-navigate');
    assert.ok(cap);
    await runCapabilityProbe(ctx, cap!);
    assert.deepEqual(
      lastDriverCall?.tools.map((t) => t.function.name).sort(),
      ['browser_close_tab', 'browser_list', 'browser_navigate', 'browser_new_tab', 'browser_switch_tab'],
    );
  });

  test('emit-only stubs return ids the next round can act on', async () => {
    scriptedCalls = [{ name: 'browser_snapshot', args: {} }];
    const cap = getCapabilityById('browser-snapshot');
    assert.ok(cap);
    const result = await runCapabilityProbe(ctx, cap!);
    assert.equal(result.skipped, false);
    assert.equal(executedContents.length, 1);
    const stub = JSON.parse(executedContents[0]!) as { stubbed: string; nodes: { uid: number }[] };
    assert.equal(stub.stubbed, 'browser_snapshot');
    // uids, not `ref_N`: browser_click / browser_fill only accept `uid: number`, so a
    // stub that hands back anything else can never be replayed into the next call.
    assert.deepEqual(
      stub.nodes.map((n) => n.uid),
      [...CAP_STUB_SNAPSHOT_UIDS],
    );
  });

  test('the snapshot stub hands back uids the fill tool actually accepts', async () => {
    const cap = getCapabilityById('browser-snapshot');
    assert.ok(cap);
    scriptedCalls = [
      { name: 'browser_snapshot', args: {} },
      { name: 'browser_fill', args: { uid: CAP_STUB_SNAPSHOT_UIDS[0], value: 'foo' } },
      { name: 'browser_click', args: { uid: CAP_STUB_SNAPSHOT_UIDS[1] } },
    ];
    const result = await runCapabilityProbe(ctx, cap!);
    assert.equal(result.verdict, 'pass');
  });

  test('a probe that reuses the stubbed id scores above one that guesses', async () => {
    const cap = getCapabilityById('apps-email-list');
    assert.ok(cap);

    scriptedCalls = [
      { name: 'list_mail', args: { unread: true } },
      { name: 'get_thread', args: { threadId: CAP_STUB_THREAD_ID } },
    ];
    assert.equal((await runCapabilityProbe(ctx, cap!)).verdict, 'pass');

    scriptedCalls = [
      { name: 'list_mail', args: { unread: true } },
      { name: 'get_thread', args: { threadId: 'invented-id' } },
    ];
    assert.equal((await runCapabilityProbe(ctx, cap!)).verdict, 'partial');
  });

  test('a chain split across rounds is scored on every call, not the last batch', async () => {
    const cap = getCapabilityById('files-save-append');
    assert.ok(cap);
    scriptedCalls = [
      { name: 'save_file', args: { path: 'matrix/notes.md', content: '- one\n- two\n- three\n' } },
      { name: 'append_file', args: { path: 'matrix/notes.md', content: '- four\n' } },
    ];
    const result = await runCapabilityProbe(ctx, cap!);
    assert.equal(result.skipped, false);
    assert.equal(result.verdict, 'pass');

    const browser = getCapabilityById('browser-navigate');
    assert.ok(browser);
    scriptedCalls = [
      { name: 'browser_new_tab', args: { url: 'https://example.com' } },
      { name: 'browser_list', args: {} },
    ];
    assert.equal((await runCapabilityProbe(ctx, browser!)).verdict, 'pass');
  });

  test('tool results reach the verdict via executedResults', async () => {
    scriptedCalls = [{ name: 'execute_command', args: { command: 'node -e "console.log(9*7)"' } }];
    const cap = getCapabilityById('code-execute-command');
    assert.ok(cap);
    const result = await runCapabilityProbe(ctx, cap!);
    // No tool server here, so the sandbox errors and 63 never comes back — the row must
    // notice that instead of passing on the emitted call alone.
    assert.equal(result.verdict, 'partial');
    assert.match(result.reason, /63/);
  });

  test('trap tools stay stubbed even when side effects are allowed', async () => {
    scriptedCalls = [{ name: 'replace_text_in_file', args: { path: 'src/api.ts' } }];
    const cap = getCapabilityById('modes-plan');
    assert.ok(cap);
    const result = await runCapabilityProbe(
      { ...ctx, capabilityMatrix: { allowSideEffects: true } },
      cap!,
    );
    // The probe skips without a mode prompt in Node; when it does run, the trap must
    // never reach the real executor.
    if (!result.skipped) {
      const stub = JSON.parse(executedContents[0]!) as { capabilityEmitOnly?: boolean };
      assert.equal(stub.capabilityEmitOnly, true);
    } else {
      assert.match(result.reason, /mode prompt unavailable/i);
    }
  });

  test('a probe naming an unknown tool id goes n-a, never fail', async () => {
    const cap = getCapabilityById('web-search');
    assert.ok(cap);
    const broken = {
      ...cap!,
      probe: { ...(cap!.probe as { kind: string }), toolIds: ['not_a_real_tool'] },
    } as typeof cap;
    const result = await runCapabilityProbe(ctx, broken!);
    assert.equal(result.skipped, true);
    assert.equal(result.verdict, 'n-a');
    assert.match(result.reason, /unknown tool ids: not_a_real_tool/);
  });
});
