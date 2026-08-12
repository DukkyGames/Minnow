/**
 * Verdict functions for the fixed and newly automated capability probes.
 *
 * Each case is a regression against a probe that could not discriminate before:
 * `core-reasoning` scored every model partial (empty regex alternation),
 * `core-no-hallucinated-tools` passed anything that emitted a call, and the rows in
 * `probes-auto-surfaces` were manual.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CAPABILITY_PROBE_BY_ID } from '../../src/benchmark/capabilities/probes.ts';
import {
  CAP_STUB_SNAPSHOT_UIDS,
  CAP_STUB_SUB_AGENT_ID,
  CAP_STUB_THREAD_ID,
} from '../../src/benchmark/capabilities/stub-fixtures.ts';
import { CAP_MATRIX_HAYSTACK_NEEDLE } from '../../src/benchmark/capabilities/fixture-paths.ts';
import { getCapabilityProbePrompt } from '../../src/benchmark/capabilities/probe-prompts.ts';
import type {
  CapabilityProbeRunOutput,
  CapabilityProbeSpecBase,
  CapabilityToolCall,
} from '../../src/benchmark/capabilities/types.ts';

function call(name: string, args: Record<string, unknown> = {}): CapabilityToolCall {
  return { function: { name, arguments: JSON.stringify(args) } };
}

/** Build a run output; `rounds` defaults to one round holding every call. */
function out(overrides: Partial<CapabilityProbeRunOutput> = {}): CapabilityProbeRunOutput {
  const toolCalls = overrides.toolCalls ?? [];
  return {
    text: '',
    contentText: '',
    reasoningText: '',
    streamChunkCount: 3,
    toolCalls,
    rounds: overrides.rounds ?? [{ round: 0, toolCalls }],
    executedResults: [],
    offeredToolNames: [],
    ...overrides,
  };
}

function verdictOf(capabilityId: string, output: CapabilityProbeRunOutput): string {
  const spec = CAPABILITY_PROBE_BY_ID[capabilityId] as CapabilityProbeSpecBase | undefined;
  assert.ok(spec && spec.kind !== 'delegated', `${capabilityId}: no runnable probe`);
  return spec.verdict(output).verdict;
}

describe('capability probe verdicts', () => {
  test('core-reasoning discriminates instead of always scoring partial', () => {
    assert.equal(
      verdictOf('core-reasoning', out({ contentText: 'The ball costs $0.05.' })),
      'pass',
    );
    assert.equal(
      verdictOf('core-reasoning', out({ contentText: 'The ball costs $0.10.' })),
      'fail',
    );
    assert.equal(
      verdictOf(
        'core-reasoning',
        out({ contentText: '<think>1.10 - 1.00</think> The ball costs $0.05.' }),
      ),
      'partial',
    );
  });

  test('core-no-hallucinated-tools flags invented tool names', () => {
    const offered = ['get_datetime', 'save_memory'];
    assert.equal(
      verdictOf(
        'core-no-hallucinated-tools',
        out({ toolCalls: [call('get_datetime')], offeredToolNames: offered }),
      ),
      'pass',
    );
    assert.equal(
      verdictOf(
        'core-no-hallucinated-tools',
        out({ toolCalls: [call('send_slack_message')], offeredToolNames: offered }),
      ),
      'fail',
    );
    assert.equal(
      verdictOf('core-no-hallucinated-tools', out({ offeredToolNames: offered })),
      'partial',
    );
  });

  test('core-json-args catches stringified object arguments', () => {
    const good = out({ toolCalls: [call('grep', { pattern: 'TODO', path: 'matrix' })] });
    assert.equal(verdictOf('core-json-args', good), 'pass');

    const stringified = out({
      toolCalls: [{ function: { name: 'grep', arguments: '{"pattern":"{\\"raw\\":1}"}' } }],
    });
    assert.equal(verdictOf('core-json-args', stringified), 'partial');

    const broken = out({
      toolCalls: [{ function: { name: 'grep', arguments: '{"pattern":"TODO",}' } }],
    });
    assert.equal(verdictOf('core-json-args', broken), 'fail');
  });

  test('core-long-context needs the buried needle, not a truncation excuse', () => {
    assert.equal(
      verdictOf('core-long-context', out({ contentText: CAP_MATRIX_HAYSTACK_NEEDLE })),
      'pass',
    );
    assert.equal(
      verdictOf('core-long-context', out({ contentText: 'That exceeds my context window.' })),
      'partial',
    );
    assert.equal(verdictOf('core-long-context', out({ contentText: 'I could not find it.' })), 'fail');
  });

  test('core-system-prompt scores the requested output shape', () => {
    assert.equal(verdictOf('core-system-prompt', out({ contentText: 'red, green, blue' })), 'pass');
    assert.equal(
      verdictOf('core-system-prompt', out({ contentText: 'Sure! They are red, green and blue.' })),
      'partial',
    );
    assert.equal(verdictOf('core-system-prompt', out({ contentText: 'Happy to help!' })), 'fail');
  });

  test('code-execute-command verifies the command really returned 63', () => {
    const ran = out({ toolCalls: [call('execute_command', { command: 'node -e ...' })] });
    assert.equal(verdictOf('code-execute-command', { ...ran, executedResults: ['63\n'] }), 'pass');
    assert.equal(verdictOf('code-execute-command', { ...ran, executedResults: ['error'] }), 'partial');
    assert.equal(verdictOf('code-execute-command', out()), 'fail');
  });

  test('code-run-js-py accepts the mean of the numbers its prompt actually lists', () => {
    // The prompt and the verdict drifted apart once (list averaged 23.25, verdict wanted
    // 22.5) and every correct model scored partial. Recompute from the prompt text.
    const prompt = getCapabilityProbePrompt('code-run-js-py') ?? '';
    const numbers = (prompt.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    assert.ok(numbers.length >= 2, 'prompt should list the numbers to average');
    const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;

    const ran = out({ toolCalls: [call('run_python', { code: 'statistics.mean(data)' })] });
    assert.equal(
      verdictOf('code-run-js-py', { ...ran, executedResults: [`${mean}\n`] }),
      'pass',
    );
    assert.equal(
      verdictOf('code-run-js-py', { ...ran, executedResults: ['nan\n'] }),
      'partial',
    );
  });

  test('browser-snapshot requires the uids the snapshot handed back', () => {
    const withUid = out({
      toolCalls: [
        call('browser_snapshot'),
        call('browser_fill', { uid: CAP_STUB_SNAPSHOT_UIDS[0], value: 'foo' }),
      ],
    });
    assert.equal(verdictOf('browser-snapshot', withUid), 'pass');

    const guessedTarget = out({
      toolCalls: [call('browser_snapshot'), call('browser_fill', { selector: '#search' })],
    });
    assert.equal(verdictOf('browser-snapshot', guessedTarget), 'partial');

    // A uid that isn't one the snapshot returned must not pass just because the
    // digits appear somewhere in the arguments JSON.
    const wrongUid = out({
      toolCalls: [call('browser_snapshot'), call('browser_fill', { uid: 1, value: '7' })],
    });
    assert.equal(verdictOf('browser-snapshot', wrongUid), 'partial');

    const snapshotOnly = out({ toolCalls: [call('browser_snapshot')] });
    assert.equal(verdictOf('browser-snapshot', snapshotOnly), 'partial');

    const blindClick = out({ toolCalls: [call('browser_click', { uid: 1 })] });
    assert.equal(verdictOf('browser-snapshot', blindClick), 'fail');
  });

  test('agents-sub-agent-control wants list-then-cancel by returned id', () => {
    const good = out({
      toolCalls: [call('list_sub_agents'), call('cancel_sub_agent', { id: CAP_STUB_SUB_AGENT_ID })],
    });
    assert.equal(verdictOf('agents-sub-agent-control', good), 'pass');

    const wrongId = out({
      toolCalls: [call('list_sub_agents'), call('cancel_sub_agent', { id: 'made-up' })],
    });
    assert.equal(verdictOf('agents-sub-agent-control', wrongId), 'partial');
    assert.equal(verdictOf('agents-sub-agent-control', out()), 'fail');
  });

  test('apps-email-draft fails a model that archives instead of drafting', () => {
    const drafted = out({ toolCalls: [call('draft_reply', { threadId: CAP_STUB_THREAD_ID })] });
    assert.equal(verdictOf('apps-email-draft', drafted), 'pass');

    const draftedAndArchived = out({
      toolCalls: [call('draft_reply', {}), call('email_action', { action: 'archive' })],
    });
    assert.equal(verdictOf('apps-email-draft', draftedAndArchived), 'partial');

    const deleted = out({ toolCalls: [call('email_action', { action: 'delete' })] });
    assert.equal(verdictOf('apps-email-draft', deleted), 'fail');
  });

  test('modes-plan fails a model that edits through the write guard', () => {
    const plan = `# Plan\n\n1. Add a token bucket\n2. Wire the middleware\n3. Add tests\n\n${'Detail. '.repeat(30)}`;
    const planned = out({ toolCalls: [call('read_file', { path: 'src/api.ts' })], contentText: plan });
    assert.equal(verdictOf('modes-plan', planned), 'pass');

    const edited = out({
      toolCalls: [call('read_file', {}), call('replace_text_in_file', { path: 'src/api.ts' })],
      contentText: plan,
    });
    assert.equal(verdictOf('modes-plan', edited), 'fail');

    assert.equal(verdictOf('modes-plan', out({ contentText: 'Sure, sounds good.' })), 'fail');
  });

  test('mode-impeccable scores load-before-edit ordering', () => {
    const loadFirst = out({
      toolCalls: [call('load_impeccable_context'), call('save_file', {})],
      rounds: [
        { round: 0, toolCalls: [call('load_impeccable_context')] },
        { round: 1, toolCalls: [call('save_file', {})] },
      ],
    });
    assert.equal(verdictOf('mode-impeccable', loadFirst), 'pass');

    const editFirst = out({
      toolCalls: [call('save_file', {}), call('load_impeccable_context')],
      rounds: [
        { round: 0, toolCalls: [call('save_file', {})] },
        { round: 1, toolCalls: [call('load_impeccable_context')] },
      ],
    });
    assert.equal(verdictOf('mode-impeccable', editFirst), 'partial');

    assert.equal(verdictOf('mode-impeccable', out({ toolCalls: [call('save_file', {})] })), 'fail');
  });
});
