/**
 * Sub-agent runner: OpenAI structured finalization via message.parsed.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { defaultSubAgentRunner } from '../../src/agents/sub-agent-runner.ts';
import {
  resetSubAgentConfigCache,
  setRuntimeSubAgentOverrides,
} from '../../src/agents/sub-agent-config.ts';
import {
  resetCapabilitiesCache,
  setProviderCapabilitiesForTests,
  type ProviderCapabilities,
} from '../../src/providers/capability-probe.ts';
import {
  resetToolCallsMetaCache,
  setToolCallsMetaForTests,
} from '../../src/config/tool-calls-meta.ts';

const PROVIDER_ID = 'openai-test';
const MODEL_ID = 'gpt-4o-mini';
const GEN_WORK = 'gen-work-11111111-1111-1111-1111-111111111111';
const GEN_FINAL = 'gen-final-22222222-2222-2222-2222-222222222222';

const STRUCTURED_PARSED = {
  summary: 'Explored auth routes.',
  findings: [{ title: 'Gap', detail: 'Missing guard', severity: 'warn', paths: [] }],
  artifacts: [{ kind: 'note', label: 'Notes', ref: 'notes.md' }],
};

const CAPS: ProviderCapabilities = {
  schemaVersion: 1,
  probedAt: '2026-06-18T12:00:00.000Z',
  providerId: PROVIDER_ID,
  structuredOutput: true,
  structuredOutputWithTools: false,
  structuredOutputStreaming: false,
  probeError: null,
};

function proseSse(text: string): Response {
  const payload = `data: ${JSON.stringify({
    choices: [{ delta: { content: text }, finish_reason: null }],
  })}\n\ndata: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
  })}\n\nevent: end\ndata: ${JSON.stringify({ status: 'complete' })}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonCompletionSse(chunk: Record<string, unknown>): Response {
  const payload = `data: ${JSON.stringify(chunk)}\n\nevent: end\ndata: ${JSON.stringify({ status: 'complete' })}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('sub-agent runner OpenAI finalization', () => {
  const originalFetch = globalThis.fetch;
  let generationCounter = 0;

  beforeEach(() => {
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
    resetCapabilitiesCache();
    resetToolCallsMetaCache();
    setToolCallsMetaForTests({ useConstrainedDecoding: false });
    setProviderCapabilitiesForTests(PROVIDER_ID, CAPS);
    generationCounter = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetCapabilitiesCache();
    resetToolCallsMetaCache();
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
  });

  test('accepts structured outcome from message.parsed on non-stream finalization', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/config/ping')) {
        return Response.json({ ok: true, home: '.minnow', homeResolved: true });
      }
      if (url.includes('/api/config/meta')) {
        return Response.json({ toolCalls: { useConstrainedDecoding: false } });
      }
      if (url.includes('/api/config/sub-agents')) {
        return Response.json({});
      }
      if (url.includes('/api/providers') && !url.includes('/capabilities')) {
        return Response.json({
          providers: [
            {
              id: PROVIDER_ID,
              label: 'OpenAI test',
              baseUrl: 'https://example.test',
              apiKind: 'openai-v1',
              enabled: true,
              hasApiKey: true,
              hasBearer: false,
            },
          ],
          activeProviderId: PROVIDER_ID,
        });
      }
      if (url.includes('/capabilities')) {
        return Response.json(CAPS);
      }
      if (url.includes('/api/generations') && init?.method === 'POST' && !url.includes('/stream')) {
        generationCounter += 1;
        const genId = generationCounter === 1 ? GEN_WORK : GEN_FINAL;
        return Response.json({ generationId: genId });
      }
      if (url.includes(GEN_WORK) && url.includes('/stream')) {
        return proseSse('I will summarize after tools.');
      }
      if (url.includes(GEN_FINAL) && url.includes('/stream')) {
        return jsonCompletionSse({
          choices: [
            {
              message: {
                content: '',
                parsed: STRUCTURED_PARSED,
              },
              finish_reason: 'stop',
            },
          ],
        });
      }

      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    let runError: unknown;
    let out;
    try {
      out = await defaultSubAgentRunner.run({
        runId: 'run-openai-parsed',
        type: 'generalPurpose',
        task: 'Summarize auth routes',
        systemPrompt: 'You are a sub-agent.',
        tools: [],
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        summarySchema: 'minnow.sub-agent.v1',
        modelContextLimit: null,
        signal: AbortSignal.timeout(15_000),
        executeTool: async () => ({ content: 'ok' }),
      });
    } catch (err) {
      runError = err;
    }

    assert.equal(runError, undefined, String(runError));
    assert.ok(out, 'runner returned no output');
    assert.equal(
      out!.structuredOutcomeParseError,
      undefined,
      `parse error: ${out!.structuredOutcomeParseError ?? out!.summary}`,
    );
    assert.equal(out!.structuredOutcome?.summary, STRUCTURED_PARSED.summary);
    assert.equal(out!.summary, STRUCTURED_PARSED.summary);
    assert.equal(generationCounter, 2);
  });
});
