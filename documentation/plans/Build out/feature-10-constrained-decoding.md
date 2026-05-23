---
name: Feature 10 — Constrained decoding for tool calls
overview: Probe providers for structured-output / grammar support, build a per-turn tool-call JSON schema from enabled tools, and opt-in attach response_format on chat completions to reduce malformed tool arguments on local models.
roadmap_ref: documentation/plans/feature-audit-roadmap.md §10
status: missing
todos:
  - id: spike-lms-compat
    content: "Spike LM Studio (and one openai-v1 target): response_format + tools + stream in one request; document pass/fail matrix"
    status: pending
  - id: capability-probe-module
    content: "Add src/providers/capability-probe.ts + ~/.minnow/providers/<id>/capabilities.json persistence"
    status: pending
  - id: tool-call-schema-builder
    content: "Add src/providers/tool-call-schema.ts — JSON Schema union from enabled tool definitions for the turn"
    status: pending
  - id: loop-opt-in-path
    content: "Wire opt-in response_format in src/tools/loop.ts (runChatTurn body); safe strip + retry on upstream 400"
    status: pending
  - id: sub-agent-parity
    content: "Mirror constrained path in src/agents/sub-agent-runner.ts"
    status: pending
  - id: settings-toggle
    content: "Settings → Providers or General — Constrained tool calls (default off until probed capable)"
    status: pending
  - id: parse-args-hardening
    content: "Shared parseToolArguments with visible tool error when JSON invalid after constrained turn"
    status: pending
  - id: tests-probe-schema
    content: "Unit tests for probe result parsing, schema builder, body merge; mock upstream integration test"
    status: pending
  - id: context-doc-update
    content: "Update documentation/context.md — tool loop, providers, persistence layout"
    status: pending
isProject: false
---

# Feature 10 — Constrained decoding for tool calls

**Roadmap:** [`feature-audit-roadmap.md`](../feature-audit-roadmap.md) item **#10** (Local-model-specific).  
**Architecture context:** [`documentation/context.md`](../../context.md).  
**Primary integration:** [`src/tools/loop.ts`](../../../src/tools/loop.ts) (`runChatTurn` → `streamCompletionTurn` → `POST /api/generations`).

---

## Summary

Minnow today relies on the upstream provider to emit well-formed OpenAI-style `tool_calls` and silently coerces bad JSON in `parseToolArguments` to `{}`. Local models (especially smaller or non–tool-trained checkpoints) often stream truncated or invalid `function.arguments`, which breaks tools or runs them with empty args.

This feature adds an **opt-in constrained decoding path**: probe whether the active provider/model supports `response_format` (JSON Schema / grammar-backed sampling), and when enabled, attach a **per-turn schema** derived from the enabled tool catalog so the model is forced to emit valid JSON matching at least one tool invocation shape.

---

## Current state

| Area | Behavior | Pointers |
|------|----------|----------|
| Outbound completions | `tools` + `tool_choice: 'auto'` when any tools enabled; **no** `response_format` | [`src/tools/loop.ts`](../../../src/tools/loop.ts) `ChatCompletionBody`, `runChatTurn` loop (~L778–789) |
| Streaming | All main-chat turns use backend generations with `stream: true` | `streamCompletionTurn` → [`createGeneration`](../../../src/api/generations.ts) |
| Tool arg parsing | `JSON.parse` failure → `{}` (no user-visible parse error) | `parseToolArguments` in `loop.ts` (~L369–380); duplicate in [`sub-agent-runner.ts`](../../../src/agents/sub-agent-runner.ts) |
| Tool call assembly | SSE deltas merged via `mergeToolCallDelta` / `finalizeToolCalls` | [`src/api/chat.ts`](../../../src/api/chat.ts) |
| Provider capabilities | Load/unload only (`src/providers/capabilities.ts`) | No grammar / structured-output flags |
| Persistence | Provider profiles under `~/.minnow/providers/<id>/` | [`documentation/context.md`](../../context.md) persistence table |
| Proxy | Generation body JSON forwarded verbatim to upstream | [`server/generations/routes.js`](../../../server/generations/routes.js), [`upstream.js`](../../../server/generations/upstream.js) |

**Observed failure modes (today):**

- `finish_reason: tool_calls` but `finalizeToolCalls` yields zero rows (logged when `minnowDebugTurns` is on).
- Tool runs with `{}` args because `arguments` string is partial or non-JSON.
- LM Studio may leave malformed tool text in `message.content` instead of `tool_calls` ([LM Studio tool docs](https://lmstudio.ai/docs/developer/openai-compat/tools)).

---

## Gap

1. **No capability detection** for `response_format` / JSON Schema / grammar sampling on the active provider or model.
2. **No schema generation** from the dynamic enabled-tool set per mode/agent turn.
3. **No request wiring** to send constraints only when safe and supported.
4. **No settings surface** to enable/disable or see probe status.
5. **No structured handling** when constrained output still fails validation (silent `{}`).

**Out of scope for v1 (explicit):**

- Replacing native `tool_calls` with a text-only tool protocol (unless spike proves `response_format` + `tools` is incompatible everywhere).
- Server-side grammar generation in Node (client builds schema; server forwards body).
- Constrained decoding for non-tool completions (plain assistant prose).
- Feature **#11** full model capability matrix UI (share persistence file shape only).

---

## Goals

1. **Reduce malformed tool arguments** on capable local stacks (LM Studio GGUF/MLX structured output first).
2. **Fail safe:** if probe says unsupported, setting off, or upstream rejects body → identical behavior to today.
3. **Per-turn accuracy:** schema reflects **only** tools actually sent in that request (mode filter + work-agent allowlist + UI Designer filter).
4. **Observable:** settings and/or dev logging show constrained mode on/off and last probe result.
5. **Single implementation** of parse/validate logic shared by main loop and sub-agents.

---

## Non-goals

- Mandatory constrained mode for all users.
- Automatic repair of invalid JSON via a second LLM call (v2+).
- GBNF grammar string authoring by hand (use JSON Schema via `response_format` unless probe API exposes raw grammar later).

---

## Acceptance criteria

### Capability probe

- [ ] On **provider refresh** or explicit **“Probe capabilities”** in settings, Minnow runs a minimal `chat/completions` probe against the provider’s `chatCompletionsPath` and records results under `~/.minnow/providers/<providerId>/capabilities.json`.
- [ ] Probe detects at least: `structuredOutput` (JSON Schema `response_format` accepted with HTTP 2xx), and optional `structuredOutputWithTools` (same request also includes a dummy `tools` array).
- [ ] Probe is **non-destructive** (tiny `max_tokens`, fixed prompt, `stream: false` for probe only).
- [ ] Harmony / gpt-oss model ids (configurable denylist) are marked **unsupported** for constrained mode even if generic probe passes (see [lmstudio#1555](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1555)).

### Schema + request path

- [ ] When **Constrained tool calls** is enabled and capabilities allow, `runChatTurn` adds `response_format` to the completion body for turns that include `tools`.
- [ ] Schema is a **strict JSON Schema** describing one or more tool calls (see Architecture) built from [`getEnabledToolDefinitionsForMode`](../../../src/tools/client.ts) after the same filters as today.
- [ ] If upstream returns **400** (or known “unsupported response_format” signature), client **strips** `response_format` and retries the turn **once** without constraints (logged in dev).

### Runtime behavior

- [ ] Valid constrained output still flows through existing `mergeToolCallDelta` / `finalizeToolCalls` path when upstream populates `tool_calls`.
- [ ] If arguments JSON is invalid after a constrained turn, tool result shows a **clear error** (not silent `{}`), e.g. `Tool arguments were not valid JSON.`
- [ ] Sub-agent runner uses the same helper when constrained mode is on for that provider.

### Settings / UX

- [ ] Toggle **Constrained tool calls** (default **off**).
- [ ] When off or unsupported, zero change in request shape vs current production.
- [ ] Provider or model row shows short badge: `Structured output: yes/no/unknown`.

### Tests & docs

- [ ] Unit tests cover schema builder, capability merge, body augmentation, and 400 retry strip.
- [ ] [`documentation/context.md`](../../context.md) updated (tool loop + `~/.minnow/providers/.../capabilities.json`).

---

## Architecture

### High-level flow

```mermaid
sequenceDiagram
  participant UI as Settings / Chat
  participant Loop as loop.ts runChatTurn
  participant Probe as capability-probe.ts
  participant Schema as tool-call-schema.ts
  participant Gen as POST /api/generations
  participant Up as Provider upstream

  UI->>Probe: refresh provider / probe button
  Probe->>Up: minimal completion + response_format
  Up-->>Probe: 2xx or 4xx
  Probe->>Probe: write capabilities.json

  Loop->>Probe: getCapabilities(providerId, modelId)
  alt constrained enabled and supported
    Loop->>Schema: buildToolCallResponseFormat(enabledTools)
    Schema-->>Loop: response_format json_schema
    Loop->>Gen: body + tools + response_format
  else legacy
    Loop->>Gen: body + tools only
  end
  Gen->>Up: POST chat/completions
  alt upstream 400
    Loop->>Gen: retry without response_format
  end
  Up-->>Loop: SSE tool_calls deltas
  Loop->>Loop: finalizeToolCalls + parseToolArguments
```

### `src/providers/capability-probe.ts` (new)

**Responsibilities:**

- Load/save `ProviderCapabilities` from `~/.minnow/providers/<id>/capabilities.json`.
- `probeProviderCapabilities(providerId, options?)` — server-mediated or client-mediated POST (prefer **server proxy** using existing provider runtime + secrets, same as generations).
- `getModelCapabilities(providerId, modelId)` — merges provider-level flags with per-model overrides (from probe with that model loaded, or copied from provider default).
- `isConstrainedToolCallsAvailable(providerId, modelId)` — respects user toggle + denylist + `structuredOutputWithTools`.

**Suggested `capabilities.json` shape:**

```json
{
  "schemaVersion": 1,
  "probedAt": "2026-05-22T12:00:00.000Z",
  "providerId": "lm-studio-local",
  "structuredOutput": true,
  "structuredOutputWithTools": true,
  "structuredOutputStreaming": false,
  "probeError": null,
  "models": {
    "my-model-id": {
      "structuredOutput": true,
      "denyReason": null
    }
  }
}
```

**Probe implementation notes:**

- Use `stream: false`, `max_tokens: 16`, single user message, trivial schema (`{ "type": "object", "properties": { "ok": { "type": "boolean" } }, "required": ["ok"] }`).
- Second probe adds minimal `tools: [{ type: "function", function: { name: "ping", parameters: { type: "object", properties: {} } } }]`.
- Record `structuredOutputStreaming` only if a third probe with `stream: true` succeeds (main chat may still use constrained mode with non-stream fallback — see Risks).

**API surface (TypeScript):**

```ts
export interface ProviderCapabilities { /* ... */ }
export async function probeProviderCapabilities(providerId: string): Promise<ProviderCapabilities>;
export function readProviderCapabilities(providerId: string): ProviderCapabilities | null;
export function isConstrainedToolCallsAvailable(
  providerId: string,
  modelId: string,
  userEnabled: boolean,
): boolean;
```

**Server option:** Add `POST /api/providers/:id/probe-capabilities` in `server/providers/` so secrets stay server-side; client calls it from settings and after provider save. *v1 can start client-only via generations proxy if faster to ship.*

### Grammar / `response_format` opt-in path

**New:** [`src/providers/tool-call-schema.ts`](../../../src/providers/tool-call-schema.ts) (name per roadmap; implements JSON Schema, not raw GBNF strings).

**Function:** `buildToolCallResponseFormat(tools: OpenAIFunctionDefinition[]): ResponseFormatJsonSchema`

**Schema strategy (v1):**

OpenAI/LM Studio structured output expects `response_format.type === 'json_schema'` with a single root schema ([LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)).

Root object (conceptual):

```json
{
  "type": "object",
  "properties": {
    "tool_calls": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "enum": ["read_file", "save_file"] },
          "arguments": { "type": "object", "additionalProperties": true }
        },
        "required": ["name", "arguments"],
        "additionalProperties": false
      },
      "minItems": 1
    }
  },
  "required": ["tool_calls"],
  "additionalProperties": false
}
```

- For each enabled tool, add a **branch** via `oneOf` on the array item: `name` const + `arguments` matching that tool’s `parameters` schema (copy from [`OpenAIFunctionDefinition`](../../../src/tools/definitions.ts)).
- Cap tool count in schema (e.g. max 8 items) to match `maxToolTurns` reality and schema size limits.
- Set `strict: true` on the wrapper per provider docs.

**Important:** Upstream may still map valid JSON in `message.content` into `tool_calls` on LM Studio; Minnow should keep consuming `delta.tool_calls` first. If spike shows content-only structured output, add a **parser fallback** in `streamCompletionTurn` that extracts JSON from `fullText` when `tool_calls` is empty but `finish_reason` suggests tools (v1.1 — document in spike).

### [`src/tools/loop.ts`](../../../src/tools/loop.ts) integration

1. Extend `ChatCompletionBody` with optional `response_format` (typed in new `src/providers/completion-body.ts` or inline).
2. After `enabledTools` resolved (~L765–770), call:

```ts
if (shouldUseConstrainedToolCalls(provider.id, sendModelId)) {
  body.response_format = buildToolCallResponseFormat(enabledTools);
}
```

3. In `streamCompletionTurn` or `runChatTurn`, on generation error containing `response_format` / `json_schema` / `grammar`, retry turn without `response_format` (once).
4. Replace local `parseToolArguments` with import from `src/tools/parse-tool-arguments.ts`; pass `constrained: boolean` to surface parse errors in `renderToolResult`.

**Do not** attach `response_format` when `enabledTools.length === 0`.

### Sub-agents

[`src/agents/sub-agent-runner.ts`](../../../src/agents/sub-agent-runner.ts) — same `buildToolCallResponseFormat` + probe gate for `SubAgentCompletionBody` (~L144–155).

### Settings

- **Location:** Settings → **Providers** (per provider) + optional global default in `config.json`: `toolCalls.constrainedDefault: boolean`.
- **Controls:** Toggle “Constrained tool calls”; button “Probe structured output”; show last `probedAt` + badges.
- **Denylist:** Advanced textarea or built-in list `harmonyDenyModels: string[]` (glob on model id).

### Config persistence

| File | Purpose |
|------|---------|
| `~/.minnow/providers/<id>/capabilities.json` | Probe results (shared with future **#11** model capability matrix) |
| `~/.minnow/config.json` | User default toggle `toolCalls.useConstrainedDecoding` |

---

## Key files

| Action | Path |
|--------|------|
| **New** | `src/providers/capability-probe.ts` |
| **New** | `src/providers/tool-call-schema.ts` |
| **New** | `src/tools/parse-tool-arguments.ts` (shared parse + error strings) |
| **New** | `src/providers/completion-types.ts` (optional shared body types) |
| **Edit** | `src/tools/loop.ts` — body build, retry, parse import |
| **Edit** | `src/agents/sub-agent-runner.ts` — parity |
| **Edit** | `src/providers/types.ts` — optional `capabilitiesUrl` / flags on `ProviderPublic` |
| **Edit** | `server/providers/*` — probe route (recommended) |
| **Edit** | `src/ui/settings-providers.ts` (or new section) — toggle + probe |
| **Edit** | `documentation/context.md` |
| **Test** | `test/providers/capability-probe.test.mts` |
| **Test** | `test/providers/tool-call-schema.test.mts` |
| **Test** | `test/tools/constrained-loop-body.test.mts` |

---

## Implementation phases

### Phase 0 — Spike (blocking)

| Task | Detail |
|------|--------|
| Matrix | LM Studio + one `openai-v1` provider: combinations of `tools`, `response_format`, `stream: true/false` |
| Outcome | Decision table in this doc’s “Spike results” subsection (fill when done) |
| Harmony | Confirm denylist behavior for gpt-oss / Harmony-tagged models |

### Phase 1 — Capability probe + persistence

- Implement `capability-probe.ts` + JSON schema version field.
- Server route `POST /api/providers/:id/probe-capabilities` (recommended).
- Wire “Probe” in settings; run probe after provider save (async, non-blocking).

### Phase 2 — Tool-call schema builder

- Implement `buildToolCallResponseFormat` with `oneOf` per tool.
- Unit tests: 0 tools → null; 1 tool → enum name; 2+ tools → oneOf branches; large catalog truncation policy (top N or mode subset only).

### Phase 3 — Main chat loop opt-in

- `loop.ts` body augmentation + 400 retry strip.
- Shared `parseToolArguments` with error messaging.
- Dev flag `localStorage.minnowDebugConstrained = '1'` logs schema size and retry events.

### Phase 4 — Sub-agent parity + polish

- `sub-agent-runner.ts` wiring.
- Settings badges; `context.md` update.

### Phase 5 — Streaming strategy (if spike failed streaming)

- Option A: constrained turns use `stream: false` internally (buffer then fake SSE for UI).
- Option B: keep stream, accept provider that only validates JSON at end.
- Document chosen approach in context.md.

---

## Dependencies

| Dependency | Relationship |
|------------|----------------|
| Backend-owned generations | **Required** — all main-chat bodies flow through `/api/generations` |
| [`src/tools/definitions.ts`](../../../src/tools/definitions.ts) | **Required** — parameter schemas source of truth |
| Feature **#11** Model capability detection | **Soft** — share `capabilities.json`; #10 can land first with probe-only fields |
| Feature **#9** Sampler presets | **Orthogonal** — same body merge point in `loop.ts` later |
| Feature **#19** Determinism / replay | **Future** — record whether turn used constrained mode |
| LM Studio ≥ structured output support | **External** — model card must support structured output |

**Suggested sequence:** After **#9** sampler merge point is defined, implement #10 body merge in the same helper (`buildCompletionBody`) to avoid double edits.

---

## Tests

### Unit (`node --test` / `tsx`)

| Suite | Cases |
|-------|--------|
| `tool-call-schema.test.mts` | Empty tools; single tool; required fields; enum of names; schema byte size under limit |
| `capability-probe.test.mts` | Parse persisted JSON; merge model overrides; denylist blocks availability |
| `parse-tool-arguments.test.mts` | Valid JSON; invalid → error string when `constrained: true`; legacy `{}` when `constrained: false` |
| `constrained-loop-body.test.mts` | `shouldUseConstrainedToolCalls` + body snapshot (no network) |

### Integration (mock upstream)

- Mock server returns 400 on `response_format` → client retries without it (assert two generation creates).
- Mock SSE with valid `tool_calls` after constrained body.

### Manual QA

1. LM Studio, tool-capable 7B+ model, constrained **on** → `read_file` with required `path` never empty when model calls tool.
2. Toggle **off** → identical network payload to pre-feature (diff HAR or debug log).
3. Provider without structured output → probe shows **no**; toggle disabled or no-op.
4. gpt-oss / Harmony model → constrained disabled by denylist.
5. Sub-agent with tools → same behavior.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `response_format` + `tools` + `stream: true` unsupported | Feature ineffective or broken main chat | Phase 0 spike; single retry without constraints; optional non-stream constrained turn |
| JSON Schema too large (56 tools) | 400 / timeout / context blow-up | Schema only for **enabled** tools per turn; cap `oneOf` branches; strict enum only on `name` |
| Provider ignores schema when `tools` present | No improvement | Spike; LM Studio content-parse fallback (v1.1) |
| Harmony / gpt-oss + grammar | Garbled output ([issue #1555](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1555)) | Model denylist; never enable constrained for matched ids |
| Double retry loops | Extra latency | Max **one** strip-and-retry per turn |
| Probe false positive | Broken user experience | Conservative probe (strict schema); user toggle default **off** |
| `parseToolArguments` behavior change | Scripts relied on `{}` | Only strict errors when constrained flag true for that turn |
| Sub-agent / main divergence | Inconsistent agent behavior | Shared modules only |
| Persisted capabilities stale | Wrong badge after LM Studio upgrade | Re-probe on provider edit + manual button |

---

## Open questions (resolve in Phase 0 spike)

1. Does LM Studio populate `delta.tool_calls` when `response_format` is set, or only `message.content` JSON?
2. Is `strict: "true"` required for all local backends?
3. Should constrained mode apply to **title** / **non-tool** generations? (Default: **no**.)
4. Per-model vs per-provider probe — probe only loaded model or generic endpoint capability?

---

## Spike results (fill after Phase 0)

| Provider | apiKind | tools + response_format | stream + constrained | Notes |
|----------|---------|-------------------------|----------------------|-------|
| LM Studio | lm-studio-v0 | TBD | TBD | |
| Other | openai-v1 | TBD | TBD | |

---

## Related roadmap items

- **#11** Model capability detection — extend same `capabilities.json` with `context_length`, VLM, etc.
- **#9** Sampler presets — merge completion body in one builder before POST.
- **#19** Determinism — record `constrainedDecoding: boolean` per generation for replay fidelity.

---

## References

- [LM Studio — Structured Output](https://lmstudio.ai/docs/developer/openai-compat/structured-output) (`response_format.json_schema`, grammar via llama.cpp / Outlines)
- [LM Studio — Tool Use](https://lmstudio.ai/docs/developer/openai-compat/tools) (parsing into `tool_calls`)
- Minnow tool loop: [`documentation/context.md`](../../context.md) § Tool loop and client
- Generations proxy: [`documentation/plans/references/backend-owned-generations.md`](../references/backend-owned-generations.md)
