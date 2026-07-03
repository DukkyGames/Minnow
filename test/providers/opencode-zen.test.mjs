/**
 * OpenCode Zen Responses API routing and SSE translation (MIN-330).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  chatCompletionBodyToResponsesApi,
  convertResponsesJsonToChatCompletion,
  convertResponsesSseBlockToChatCompletion,
  normalizeOpenCodeZenRelativePath,
  openCodeZenModelUsesResponsesApi,
  prepareOpenCodeZenRequestBody,
  resolveOpenCodeZenUpstreamUrl,
} from '../../server/providers/opencode-zen.js';
import { sanitizeCompletionBodyForProvider } from '../../server/providers/sanitize-completion-body.js';

describe('openCodeZenModelUsesResponsesApi', () => {
  test('matches GPT and o-series ids', () => {
    assert.equal(openCodeZenModelUsesResponsesApi('gpt-5.4'), true);
    assert.equal(openCodeZenModelUsesResponsesApi('gpt-5.1-codex'), true);
    assert.equal(openCodeZenModelUsesResponsesApi('o3-mini'), true);
    assert.equal(openCodeZenModelUsesResponsesApi('claude-sonnet-4-6'), false);
    assert.equal(openCodeZenModelUsesResponsesApi('kimi-k2.5'), false);
  });
});

describe('normalizeOpenCodeZenRelativePath', () => {
  test('strips duplicate /v1 when base already ends with /v1', () => {
    assert.equal(
      normalizeOpenCodeZenRelativePath('https://opencode.ai/zen/v1', '/v1/chat/completions'),
      '/chat/completions',
    );
    assert.equal(
      normalizeOpenCodeZenRelativePath('https://opencode.ai/zen/v1', '/v1/models'),
      '/models',
    );
  });

  test('leaves paths unchanged for non-OpenCode hosts', () => {
    assert.equal(
      normalizeOpenCodeZenRelativePath('https://api.openai.com', '/v1/chat/completions'),
      '/v1/chat/completions',
    );
  });
});

describe('resolveOpenCodeZenUpstreamUrl', () => {
  test('routes GPT models to /responses', () => {
    assert.equal(
      resolveOpenCodeZenUpstreamUrl(
        'https://opencode.ai/zen/v1',
        '/v1/chat/completions',
        'gpt-5.4',
      ),
      'https://opencode.ai/zen/v1/responses',
    );
  });

  test('routes non-GPT models to normalized chat completions', () => {
    assert.equal(
      resolveOpenCodeZenUpstreamUrl(
        'https://opencode.ai/zen/v1',
        '/v1/chat/completions',
        'kimi-k2.5',
      ),
      'https://opencode.ai/zen/v1/chat/completions',
    );
  });
});

describe('chatCompletionBodyToResponsesApi', () => {
  test('maps messages and max_tokens to responses input', () => {
    const out = chatCompletionBodyToResponsesApi({
      model: 'gpt-5.4',
      stream: true,
      max_tokens: 2048,
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      reasoning_effort: 'high',
    });

    assert.equal(out.model, 'gpt-5.4');
    assert.equal(out.max_output_tokens, 2048);
    assert.equal(out.stream, true);
    assert.equal(out.reasoning.effort, 'high');
    assert.equal(out.input.length, 2);
    assert.equal(out.input[1].content[0].type, 'input_text');
    assert.equal(out.temperature, undefined);
  });
});

describe('convertResponsesSseBlockToChatCompletion', () => {
  test('translates output_text.delta to chat.completion.chunk', () => {
    const block = [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hi","response":{"id":"resp_1","model":"gpt-5.4"}}',
    ].join('\n');

    const out = convertResponsesSseBlockToChatCompletion(block);
    assert.ok(out);
    assert.match(out, /^data: /);
    const payload = JSON.parse(out.slice(6).trim());
    assert.equal(payload.object, 'chat.completion.chunk');
    assert.equal(payload.choices[0].delta.content, 'Hi');
  });
});

describe('convertResponsesJsonToChatCompletion', () => {
  test('maps completed response output to chat.completion', () => {
    const out = convertResponsesJsonToChatCompletion({
      response: {
        id: 'resp_abc',
        model: 'gpt-5.4',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        ],
        stop_reason: 'stop',
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    });

    assert.equal(out.object, 'chat.completion');
    assert.equal(out.choices[0].message.content, 'Done.');
    assert.equal(out.choices[0].finish_reason, 'stop');
    assert.equal(out.usage.prompt_tokens, 10);
  });
});

describe('prepareOpenCodeZenRequestBody', () => {
  test('rewrites GPT bodies to responses API JSON', () => {
    const input = Buffer.from(
      JSON.stringify({
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'ping' }],
        stream: true,
      }),
      'utf8',
    );
    const { body, usesResponsesApi } = prepareOpenCodeZenRequestBody(
      input,
      'https://opencode.ai/zen/v1',
      'gpt-5',
    );
    assert.equal(usesResponsesApi, true);
    const parsed = JSON.parse(body.toString('utf8'));
    assert.ok(Array.isArray(parsed.input));
    assert.equal(parsed.input[0].content[0].text, 'ping');
  });
});

describe('sanitizeCompletionBodyForProvider (server)', () => {
  test('strips temperature for gpt-5 on openai-v1', () => {
    const out = sanitizeCompletionBodyForProvider(
      { model: 'gpt-5.4', temperature: 0.7, top_p: 0.9, max_tokens: 512 },
      { apiKind: 'openai-v1' },
    );
    assert.equal(out.temperature, undefined);
    assert.equal(out.top_p, undefined);
    assert.equal(out.max_completion_tokens, 512);
    assert.equal(out.max_tokens, undefined);
  });
});
