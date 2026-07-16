/**
 * Sub-agent tool turns must replay DeepSeek reasoning_content on follow-up requests.
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
const GEN_TOOL = 'gen-tool-11111111-1111-1111-1111-111111111111';
const GEN_FINAL = 'gen-final-22222222-2222-2222-2222-222222222222';

const CAPS: ProviderCapabilities = {
  schemaVersion: 1,
  probedAt: '2026-07-15T12:00:00.000Z',
  providerId: PROVIDER_ID,
  structuredOutput: false,
  structuredOutputWithTools: false,
  probeError: null,
};

function toolCallSse(): Response {
  const chunks = [
    `data: ${JSON.stringify({
      choices: [
        {
          delta: { reasoning_content: 'Need to list the repo root.' },
          finish_reason: null,
        },
      ],
    })}\n\n`,
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

describe('sub-agent DeepSeek reasoning replay', () => {
  const originalFetch = globalThis.fetch;
  let generationPosts = 0;
  let capturedSecondBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
    resetCapabilitiesCache();
    resetToolCallsMetaCache();
    setToolCallsMetaForTests({ useConstrainedDecoding: false });
    setProviderCapabilitiesForTests(PROVIDER_ID, CAPS);
    generationPosts = 0;
    capturedSecondBody = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetCapabilitiesCache();
    resetToolCallsMetaCache();
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
  });

  test('includes reasoning_content on follow-up completion after a tool turn', async () => {
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
        const body = JSON.parse(String(init?.body ?? '{}')) as { body?: Record<string, unknown> };
        if (generationPosts === 2) {
          capturedSecondBody = body.body ?? null;
        }
        const genId = generationPosts === 1 ? GEN_TOOL : GEN_FINAL;
        return Response.json({ generationId: genId });
      }
      if (url.includes(GEN_TOOL) && url.includes('/stream')) {
        return toolCallSse();
      }
      if (url.includes(GEN_FINAL) && url.includes('/stream')) {
        return proseSse(
          '{"summary":"Listed root.","findings":[],"artifacts":[]}',
        );
      }

      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const out = await defaultSubAgentRunner.run({
      runId: 'run-deepseek-replay',
      type: 'explore',
      task: 'List the repo root',
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

    assert.ok(capturedSecondBody, 'expected a second generation POST');
    const messages = capturedSecondBody!.messages as Array<Record<string, unknown>>;
    const assistantToolRow = messages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );
    assert.ok(assistantToolRow, 'follow-up body should include prior assistant tool row');
    assert.equal(
      assistantToolRow!.reasoning_content,
      'Need to list the repo root.',
      'DeepSeek requires reasoning_content replay after tool calls',
    );
    assert.equal(out.toolTurns, 1);
  });

  test('includes empty reasoning_content when the tool turn had no reasoning stream', async () => {
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
        const body = JSON.parse(String(init?.body ?? '{}')) as { body?: Record<string, unknown> };
        if (generationPosts === 2) {
          capturedSecondBody = body.body ?? null;
        }
        const genId = generationPosts === 1 ? GEN_TOOL : GEN_FINAL;
        return Response.json({ generationId: genId });
      }
      if (url.includes(GEN_TOOL) && url.includes('/stream')) {
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
      if (url.includes(GEN_FINAL) && url.includes('/stream')) {
        return proseSse(
          '{"summary":"Listed root.","findings":[],"artifacts":[]}',
        );
      }

      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const out = await defaultSubAgentRunner.run({
      runId: 'run-deepseek-empty-reasoning',
      type: 'explore',
      task: 'List the repo root',
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

    assert.ok(capturedSecondBody, 'expected a second generation POST');
    const messages = capturedSecondBody!.messages as Array<Record<string, unknown>>;
    const assistantToolRow = messages.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );
    assert.ok(assistantToolRow, 'follow-up body should include prior assistant tool row');
    assert.equal(
      assistantToolRow!.reasoning_content,
      '',
      'DeepSeek tool turns must replay reasoning_content even when empty',
    );
    assert.equal(out.toolTurns, 1);
  });
});
