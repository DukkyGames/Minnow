# Odysseus Port 04 — Model Fallback Chains And Dead-Host Cooldown

Tier: 1  
Effort: M  
Priority: High  
Status: Planned  
Linear: [MIN-128](https://linear.app/minnowai/issue/MIN-128/odysseus-port-04-model-fallback-chains)

## Goal

Let Minnow recover from down providers or failing local hosts by trying an ordered fallback chain before a generation has emitted tokens. This should make primary local-provider outages less disruptive without surprising users by switching models mid-response.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | None (benefits #8 synthesis utility-role binding when added) |
| npm packages | None |
| External binaries | Two providers for manual failover QA |
| Credentials | Existing provider setup |
| Estimated effort | 3–5 days |

## Prerequisites & Deliverables

| Deliverable | Description |
|-------------|-------------|
| Fallback config | Role-based chains in `config.json` |
| Chain resolver | `server/generations/fallback.js` |
| Dead-host cooldown | Module-level map keyed by origin |
| Upstream retry | Pre-first-token sequential try in `upstream.js` |
| Settings UI | Chain editor under Models (`model-routing` section) |
| Call-site wiring | Chat, sub-agents, titles, research, evals (optional) |
| Tests | Cooldown, retryable errors, no mid-stream failover |

## Verified Source Context

- Odysseus reference: `src/llm_core.py`.
  - `llm_call_with_fallback()`, `stream_llm_with_fallback()`, `_dedupe_candidates()`.
  - Dead-host cooldown keyed by host origin; response cache for utility calls.
- Minnow provider endpoint resolver: `src/providers/resolve.ts` (client-side).
- Generation route: `server/generations/routes.js` (resolves exactly one provider today).
- Upstream pump: `server/generations/upstream.js` (streams exactly one URL).
- Provider runtime: `getProviderRuntime()` in `server/providers/store.js`.
- Settings: `src/ui/settings-model-routing.ts`, `src/settings/model-routing-catalog.ts`.
- Config: `server/config/home.js`, `server/config/validators.js`.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/generations/fallback.js` | Chain resolver, retryable error classification |
| `server/generations/host-cooldown.js` | Dead-host map + expiry |
| `test/generations/fallback.test.mjs` | Chain resolution tests |
| `test/generations/host-cooldown.test.mjs` | Cooldown expiry tests |
| `test/generations/upstream-failover.test.mjs` | Pre-token retry + no mid-stream tests |

## Files to Modify

| Path | Change |
|------|--------|
| `server/config/home.js` | Default `fallbackChains` block |
| `server/config/validators.js` | Validate chains, roles, cooldown |
| `server/generations/routes.js` | Accept `fallbackRole`, build candidate chain |
| `server/generations/upstream.js` | Sequential pre-token retry |
| `server/system/middleware.js` | Optional `GET /api/system/host-health` |
| `src/ui/settings-model-routing.ts` | Chain editor UI per role |
| `src/settings/model-routing-catalog.ts` | Types for fallback config |
| `src/tools/loop.ts` | Pass `fallbackRole: 'default'` on main chat |
| `src/agents/sub-agent-runner.ts` | Pass appropriate role |
| `src/chat/titles/generate.ts` | Pass `utility` role |
| `documentation/context.md` | Document fallback behavior |

## Config Schema

```json
{
  "fallbackChains": {
    "enabled": true,
    "cooldownSeconds": 60,
    "maxChainLength": 4,
    "roles": {
      "default": [
        { "providerId": "lm-studio-local", "modelId": "" },
        { "providerId": "openai-cloud", "modelId": "gpt-4o-mini" }
      ],
      "utility": [],
      "research": [],
      "vision": []
    }
  }
}
```

- `modelId: ""` means use the request's model id.
- Non-empty `modelId` overrides for that chain step.
- Empty role array = no fallback for that role.
- `research` is a Minnow extension — wire only when research binding is clear.

## Retryable vs non-retryable errors

| Retryable (try next candidate) | Non-retryable (surface error) |
|-------------------------------|------------------------------|
| ECONNREFUSED, ENOTFOUND, ETIMEDOUT | 401, 403 (auth) |
| DNS failure | 400 model not found |
| Connection timeout before bytes | User cancellation |
| Selected 502/503/504 | 422 validation errors |

## API Routes

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/system/host-health` | `{ hosts: [{ origin, dead, expiresAt }] }` |

Optional diagnostics only; not required for v1 failover.

## Detailed Implementation Phases

### Phase 1 — Config and validation (0.5 day)

1. Add `fallbackChains` defaults to `server/config/home.js` (`enabled: false`).
2. Validate in `server/config/validators.js`:
   - `cooldownSeconds` ≥ 10, `maxChainLength` 1–8.
   - Each candidate has `providerId`; `modelId` optional string.
   - Roles: `default`, `utility`, `vision`; `research` optional.
3. Exclude disabled providers at resolve time.
4. Tests: invalid config rejected, defaults merge.

### Phase 2 — Chain resolver (1 day)

1. Create `server/generations/fallback.js`:
   - `resolveFallbackChain({ role, primaryProviderId, primaryModelId, config })` → ordered candidates.
   - Primary provider/model is always first unless role chain explicitly replaces primary.
   - Dedupe by `providerId:modelId`.
   - Cap at `maxChainLength`.
2. `classifyUpstreamError(err, response)` → `retryable` | `fatal`.
3. Tests: chain order, dedupe, disabled provider skip, model override.

### Phase 3 — Dead-host cooldown (0.5 day)

1. Create `server/generations/host-cooldown.js`:
   - `markHostDead(origin, cooldownSeconds)`.
   - `isHostDead(origin)` → boolean.
   - `listDeadHosts()` for diagnostics.
   - Key by URL origin (`http://localhost:1234`), not full path.
2. Mark dead on retryable connection failures only.
3. Auto-expire after `cooldownSeconds`.
4. Tests: expiry, re-mark extends cooldown.

### Phase 4 — Generation start + upstream pump (1.5 days)

1. **`server/generations/routes.js`:**
   - Accept optional `fallbackRole` in POST body.
   - Build `candidates[]` via resolver.
   - Store on generation state: `{ candidates, activeIndex, failoverDisabled: false }`.
2. **`server/generations/upstream.js`:**
   - For each candidate while `!failoverDisabled && !bytesEmitted`:
     - Resolve URL, auth, model override.
     - Skip if `isHostDead(origin)`.
     - Attempt fetch/stream.
     - On retryable failure before bytes → next candidate.
     - On first byte/token → set `failoverDisabled = true`.
     - On fatal error → return error immediately.
   - Record `chosenProviderId`, `chosenModelId`, `fallbackUsed: boolean` in generation metadata.
3. Emit client-visible notice when fallback used (generation event or metadata field).
4. Tests: mock fetch — refused → success on second; bytes then fail → no switch.

### Phase 5 — Settings UI (1 day)

1. Extend `src/ui/settings-model-routing.ts`:
   - Toggle: fallback enabled.
   - Input: cooldown seconds.
   - Per-role ordered list editor (add/remove/reorder candidates).
   - Provider picker + optional model override per row.
2. Optional: host-health panel showing dead hosts + expiry.
3. Save through existing config API.

### Phase 6 — Call-site wiring (0.5 day)

| Call site | File | `fallbackRole` |
|-----------|------|----------------|
| Main chat | `src/tools/loop.ts` | `default` |
| Sub-agents | `src/agents/sub-agent-runner.ts` | `default` or per-type |
| Title generation | `src/chat/titles/generate.ts` | `utility` |
| Deep research | research helper calls | `research` |
| Memory synthesis (#8) | synthesis module | `utility` |
| Benchmark/evals | optional | `utility` |

## Implementation TODOs

- [ ] Add fallback config metadata and validation
- [ ] Add fallback defaults to `server/config/home.js`
- [ ] Add fallback validation/default merge logic to `server/config/validators.js`
- [ ] Add `server/generations/fallback.js` or equivalent server-side chain resolver
- [ ] Add a module-level dead-host cooldown map keyed by provider `baseUrl` origin
- [ ] Extend `/api/generations` payload handling to accept optional `fallbackRole`
- [ ] Implement pre-first-token failover only
- [ ] Add optional host-health route under `/api/system/host-health`
- [ ] Add Settings UI under existing `model-routing` files for chains, cooldown, and optional cache toggle
- [ ] Enumerate and wire all LLM call sites that should benefit
- [ ] Add tests for cooldown, retryable error classification, and no mid-stream failover
- [ ] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_llm_core_fallback.py` | `test/generations/fallback.test.mjs` |

## Acceptance Criteria

- With no fallback configured, all existing generation behavior is unchanged.
- If the primary host refuses connection, the next configured provider/model is used.
- If the primary emits any token bytes, failure is surfaced instead of switching models mid-stream.
- A dead host is skipped until cooldown expiry.
- Cooldown expiry allows retrying a recovered host.
- User can see when fallback was used.

## Verification

- Add generation unit tests with mocked fetch failures and delayed streaming bodies.
- Manual: configure two providers, stop the primary host, send a turn, confirm the secondary completes.
- Manual: restart the primary host and confirm it is retried after cooldown.
- Run provider and generation tests touched by the implementation.

## Risks And Guardrails

- Mid-stream model switching is user-visible and must not happen.
- Cache keys, if implemented, must include model, provider, messages, sampler, thinking mode, and tool constraints. Limit cache to utility/background calls unless a later plan explicitly handles main-chat cache UX.
- Do not silently hide auth/config errors by falling back forever; classify retryable failures narrowly.
