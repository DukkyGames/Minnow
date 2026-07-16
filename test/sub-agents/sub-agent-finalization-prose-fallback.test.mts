/**
 * When structured finalization fails after tool work, fall back to the work-turn prose.
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

const PROVIDER_ID = 'opencode-go-deepseek';
const MODEL_ID = 'deepseek/deepseek-v4-flash';
const GEN_TOOL = 'gen-tool-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GEN_PROSE = 'gen-prose-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GEN_FINAL = 'gen-final-cccccccc-cccc-cccc-cccc-cccccccccccc';

const CAPS: ProviderCapabilities = {
  schemaVersion: 1,
  probedAt: '2026-07-16T00:00:00.000Z',
  providerId: PROVIDER_ID,
  structuredOutput: false,
  structuredOutputWithTools: false,
  probeError: null,
};

const WORK_PROSE =
  'Here is what I found in the repository after listing and reading key files. ' +
  'The main entry point is src/main.ts and tests live under test/.';

function toolCallSse(): Response {
  const chunks = [
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_list',
                type: 'function',
                function: { name: 'list_directory', arguments: '{"path":"."}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    })}\n\n`,
    `event: end\ndata: ${JSON.stringify({ status: 'complete' })}\n\n`,
  ].join('');
  return new Response(chunks, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

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

describe('sub-agent finalization prose fallback', () => {
  const originalFetch = globalThis.fetch;
  let generationPosts = 0;

  beforeEach(() => {
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
    resetCapabilitiesCache();
    resetToolCallsMetaCache();
    setToolCallsMetaForTests({ useConstrainedDecoding: false });
    setProviderCapabilitiesForTests(PROVIDER_ID, CAPS);
    generationPosts = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetCapabilitiesCache();
    resetToolCallsMetaCache();
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
  });

  test('returns work-turn prose when finalization fetch fails after tools', async () => {
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
              label: 'OpenCode Go',
              baseUrl: 'https://opencode.ai/zen/go',
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
        generationPosts += 1;
        const genId =
          generationPosts === 1 ? GEN_TOOL : generationPosts === 2 ? GEN_PROSE : GEN_FINAL;
        return Response.json({ generationId: genId });
      }
      if (url.includes(GEN_TOOL) && url.includes('/stream')) {
        return toolCallSse();
      }
      if (url.includes(GEN_PROSE) && url.includes('/stream')) {
        return proseSse(WORK_PROSE);
      }
      if (url.includes(GEN_FINAL) && url.includes('/stream')) {
        throw new TypeError('Failed to fetch');
      }

      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const out = await defaultSubAgentRunner.run({
      runId: 'run-finalization-fallback',
      type: 'explore',
      task: 'Explore the repo root',
      systemPrompt: 'You are a sub-agent.',
      tools: [
        {
          type: 'function',
          function: {
            name: 'list_directory',
            description: 'List files',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
      ],
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      summarySchema: 'minnow.sub-agent.v1',
      modelContextLimit: null,
      signal: AbortSignal.timeout(15_000),
      executeTool: async () => ({ content: 'README.md' }),
    });

    assert.equal(out.toolTurns, 1);
    assert.equal(out.structuredOutcome?.summary, WORK_PROSE);
    assert.equal(out.summary, WORK_PROSE);
  });
});
