/**
 * Probe OpenCode Zen with built-in + live MCP tools.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { streamText } from 'ai';
import { BUILT_IN_TOOLS } from '../src/tools/definitions.ts';
import { mapOpenAiTools } from '../server/generations/anthropic/openai-tools.js';
import { buildAnthropicProvider } from '../server/generations/anthropic/provider-runtime.js';
import {
  adjustAnthropicRequestForGateway,
  adjustAnthropicThinkingForToolHistory,
} from '../src/lib/anthropic-thinking-style.mjs';
import { openAiMessagesToCoreMessages } from '../server/generations/anthropic/openai-to-core-messages.js';
import { readEncryptedJsonFile } from '../server/security/secret-box.js';
import { listEnabledMcpTools } from '../server/mcp/registry.js';
import { sanitizeAnthropicGatewayRequestBody } from '../server/generations/anthropic/gateway-fetch.js';

const providerId = 'opencodezen';
const root = join(homedir(), '.minnow/providers', providerId);
const profile = JSON.parse(readFileSync(join(root, 'profile.json'), 'utf8'));
const secrets = await readEncryptedJsonFile(join(root, 'secrets.json'), {
  apiKey: '',
  bearerToken: '',
  headerOverrides: {},
});

const RUNTIME = {
  profile,
  paths: { chatCompletionsPath: profile.chatCompletionsPath || '/zen/v1/messages' },
  secrets,
};

const mcpTools = await listEnabledMcpTools();
const allTools = [...BUILT_IN_TOOLS.map((t) => t.definition), ...mcpTools];
console.log('builtin', BUILT_IN_TOOLS.length, 'mcp', mcpTools.length, 'total', allTools.length);
for (const t of mcpTools) {
  console.log('mcp tool', t.function.name, 'schema keys', Object.keys(t.function.parameters ?? {}));
  console.log(JSON.stringify(t.function.parameters).slice(0, 400));
}

/** @type {Record<string, unknown> | null} */
let captured = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  captured = JSON.parse(String(init?.body));
  const res = await originalFetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    console.log('HTTP', res.status, text.slice(0, 500));
    return new Response(text, { status: res.status, headers: res.headers });
  }
  return res;
};

const messages = [
  { role: 'user', content: 'list files' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'list_directory', arguments: '{"path":"."}' },
      },
    ],
  },
  { role: 'tool', tool_call_id: 'call_1', content: 'README.md' },
  { role: 'user', content: 'thanks' },
];

let body = adjustAnthropicRequestForGateway(profile.baseUrl, {
  model: 'claude-opus-4-7',
  stream: true,
  max_tokens: 32768,
  messages,
  tools: allTools,
  tool_choice: 'auto',
  providerOptions: {
    anthropic: { thinking: { type: 'adaptive' }, effort: 'medium' },
  },
});
body = adjustAnthropicThinkingForToolHistory('claude-opus-4-7', body);

const anthropic = buildAnthropicProvider(RUNTIME);
const mapped = mapOpenAiTools(body.tools);

try {
  const result = streamText({
    model: anthropic('claude-opus-4-7'),
    messages: openAiMessagesToCoreMessages(body.messages),
    tools: mapped,
    toolChoice: 'auto',
    maxOutputTokens: 1024,
    allowSystemInMessages: true,
    providerOptions: body.providerOptions,
    abortSignal: AbortSignal.timeout(60000),
  });
  for await (const part of result.fullStream) {
    if (part.type === 'error') throw part.error;
    if (part.type === 'text-delta') process.stdout.write(part.text);
  }
  console.log('\nOK');
} catch (err) {
  const api = err && typeof err === 'object' ? err : {};
  console.log('\nFAIL', api.statusCode, api.message ?? String(err));
}

if (captured) {
  const sanitized = sanitizeAnthropicGatewayRequestBody(captured);
  const json = JSON.stringify(sanitized);
  const hits = ['additionalProperties', '$ref', '$schema', 'maxItems', 'pattern', 'strict'].filter((k) =>
    json.includes(`"${k}"`),
  );
  console.log('captured tools', captured.tools?.length, 'bytes', json.length, 'bad keys', hits);
  const mcpCaptured = (captured.tools ?? []).filter((t) => String(t.name).startsWith('mcp__'));
  console.log('mcp captured', mcpCaptured.map((t) => t.name));
  if (mcpCaptured[0]) console.log('sample mcp schema', JSON.stringify(mcpCaptured[0].input_schema).slice(0, 500));
}
