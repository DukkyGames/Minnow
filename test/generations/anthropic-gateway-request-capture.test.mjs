/**
 * Capture outbound Anthropic gateway request shape for OpenCode Zen tool calls.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { streamText } from 'ai';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import { buildAnthropicProvider } from '../../server/generations/anthropic/provider-runtime.js';
import { mapOpenAiTools } from '../../server/generations/anthropic/openai-tools.js';
import { openAiMessagesToCoreMessages } from '../../server/generations/anthropic/openai-to-core-messages.js';
import {
  adjustAnthropicRequestForGateway,
  adjustAnthropicThinkingForToolHistory,
} from '../../src/lib/anthropic-thinking-style.mjs';

const RUNTIME = {
  profile: { baseUrl: 'https://opencode.ai', authStyle: 'bearer' },
  paths: { chatCompletionsPath: '/zen/v1/messages' },
  secrets: { bearerToken: 'test-token' },
};

describe('anthropic gateway outbound request capture', () => {
  test('builds sanitized tool request without gateway-rejected fields', async () => {
    /** @type {Record<string, unknown> | null} */
    let capturedBody = null;
    /** @type {Record<string, string> | undefined} */
    let capturedHeaders;

    const fetchImpl = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      capturedHeaders = /** @type {Record<string, string>} */ (init?.headers);
      return new Response('not-sse', { status: 200 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      const tools = BUILT_IN_TOOLS.map((t) => t.definition);
      let body = {
        model: 'claude-opus-4-6',
        stream: true,
        max_tokens: 32768,
        messages: [{ role: 'user', content: 'list files' }],
        tools,
        tool_choice: 'auto',
        providerOptions: {
          anthropic: { thinking: { type: 'adaptive' }, effort: 'medium' },
        },
      };

      body = adjustAnthropicRequestForGateway(
        'https://opencode.ai',
        adjustAnthropicThinkingForToolHistory('claude-opus-4-6', body),
      );

      const anthropic = buildAnthropicProvider(RUNTIME);
      const mappedTools = mapOpenAiTools(body.tools);
      const messages = openAiMessagesToCoreMessages(body.messages);

      const result = streamText({
        model: anthropic('claude-opus-4-6'),
        messages,
        tools: mappedTools,
        toolChoice: 'auto',
        maxOutputTokens: 32768,
        allowSystemInMessages: true,
        providerOptions: body.providerOptions,
        abortSignal: AbortSignal.timeout(5000),
      });

      try {
        for await (const _ of result.fullStream) {
          // drain until mock response fails
        }
      } catch {
        // expected — mock response is not valid SSE
      }

      assert.ok(capturedBody, 'expected fetch to be called');
      assert.equal(capturedBody.tools?.length, tools.length);
      assert.equal(capturedBody.thinking, undefined);
      assert.equal(capturedBody.output_config, undefined);

      const betaHeader =
        capturedHeaders?.['anthropic-beta'] ?? capturedHeaders?.['Anthropic-Beta'] ?? '';
      assert.equal(betaHeader.includes('structured-outputs'), false);
      assert.equal(betaHeader.includes('advanced-tool-use'), false);

      for (const tool of capturedBody.tools ?? []) {
        assert.equal(tool.eager_input_streaming, undefined);
        assert.equal(tool.strict, undefined);
        const schemaJson = JSON.stringify(tool.input_schema ?? {});
        assert.equal(schemaJson.includes('$schema'), false);
        assert.equal(schemaJson.includes('$id'), false);
        assert.equal(schemaJson.includes('maxItems'), false);
      }

      assert.deepEqual(capturedBody.tool_choice, { type: 'auto' });

      // Log for debugging when this test is run in isolation
      console.log('tool_choice', JSON.stringify(capturedBody.tool_choice));
      console.log('beta header', betaHeader || '(none)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
