# Anthropic Messages API support

> Orchestrator plan — worktree `anthropic-messages-b08c3129` (HEAD `dbd630a5`)

## Problem

Minnow's LLM stack only supports two `apiKind` values (`src/providers/types.ts`):

- `lm-studio-v0` — LM Studio REST
- `openai-v1` — OpenAI Chat Completions (`/v1/chat/completions`)

OpenCode Zen Claude models (and native Anthropic) use the **Anthropic Messages API** at `/v1/messages` (Zen: `https://opencode.ai/zen/v1/messages`). The generations pump in `server/generations/upstream.js` blindly proxies OpenAI-shaped bodies to `chatCompletionsPath` and forwards raw SSE bytes. That cannot reach Claude on Zen.

## Design decisions

| Decision | Choice |
|----------|--------|
| Scope | Generic `anthropic-v1` for any Messages-compatible gateway (Zen, Anthropic, proxies) |
| Implementation | `@ai-sdk/anthropic` + `ai` (`streamText` / `generateText`) |
| Client contract | **Unchanged** — keep OpenAI `ChatCompletionBody` + OpenAI SSE parsing in `src/api/sse-parse.ts` |
| Path field | Reuse `chatCompletionsPath` as the **messages path** (UI label changes for `anthropic-v1`) |
| `baseUrl` | Keep existing origin-only normalization; gateway prefix goes in path overrides |

## Implementation todos

- [x] Add `ai` and `@ai-sdk/anthropic` to package.json
- [x] Extend ApiKind to `anthropic-v1` across types, validate, paths (server + client), settings UI
- [x] Create `server/generations/anthropic/` bridge module
- [x] Branch upstream.js on anthropic-v1
- [x] Per-model API resolution for mixed gateways (`autoApi`, `messagesPath`, `resolveModelApi`) — MIN-322
- [x] Add anthropic-v1 thinking-to-body branch; adjust capability probes
- [x] Add missing Claude model IDs to known-context-windows.ts
- [x] Add conversion, SSE encoder, and path tests (`test/generations/anthropic-*.test.mjs`, `test/providers/paths.test.js`)
- [x] Update documentation/context.md

## Known v1 limitations

- Constrained tool calls (`response_format` json_schema) — not mapped yet
- Capability probe structured-output badge will show unknown/no for `anthropic-v1`
- Anthropic-specific features (cache control, web search, code execution) — out of scope

## Deferred

- [ ] Mocked upstream pump integration test (full `pumpAnthropicUpstream` with stubbed `ai` SDK)
