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

const providerId = 'opencodezen';
const root = join(homedir(), '.minnow/providers', providerId);
const profile = JSON.parse(readFileSync(join(root, 'profile.json'), 'utf8'));
const secrets = await readEncryptedJsonFile(join(root, 'secrets.json'), {
  apiKey: '',
  bearerToken: '',
  headerOverrides: {},
});
const RUNTIME = { profile, paths: { chatCompletionsPath: '/zen/v1/messages' }, secrets };

const mcpTools = await listEnabledMcpTools();
const allTools = [...BUILT_IN_TOOLS.map((t) => t.definition), ...mcpTools];
const bigSystem = 'You are Minnow. '.repeat(8000);

const openAiMessages = [
  { role: 'system', content: bigSystem },
  { role: 'user', content: 'list files' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'list_directory', arguments: '{"path":"."}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'call_1', content: 'README.md' },
  { role: 'user', content: 'thanks' },
];

let body = adjustAnthropicRequestForGateway(profile.baseUrl, {
  model: 'claude-opus-4-7',
  stream: true,
  max_tokens: 32768,
  messages: openAiMessages,
  tools: allTools,
  tool_choice: 'auto',
  providerOptions: { anthropic: { thinking: { type: 'adaptive' }, effort: 'medium' } },
});
body = adjustAnthropicThinkingForToolHistory('claude-opus-4-7', body);

const anthropic = buildAnthropicProvider(RUNTIME);
try {
  const result = streamText({
    model: anthropic('claude-opus-4-7'),
    messages: openAiMessagesToCoreMessages(body.messages),
    tools: mapOpenAiTools(body.tools),
    toolChoice: 'auto',
    maxOutputTokens: 32768,
    allowSystemInMessages: true,
    providerOptions: body.providerOptions,
    abortSignal: AbortSignal.timeout(90000),
  });
  for await (const part of result.fullStream) {
    if (part.type === 'error') throw part.error;
  }
  console.log('OK large system + 32768 max');
} catch (err) {
  const api = err && typeof err === 'object' ? err : {};
  console.log('FAIL', api.statusCode, api.message ?? String(err));
  if (typeof api.responseBody === 'string') console.log(api.responseBody.slice(0, 300));
}
