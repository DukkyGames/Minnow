# Step 07 — Programmatic chat titles (implementation build plan)

| Field | Value |
|-------|--------|
| **Step ID** | 07 |
| **Title** | Programmatic chat title generation |
| **Backlog** | [`to-fix.md`](../to-fix.md) item **9** — *titles should generate programaticly as an inital prompt to the agent* |
| **Roadmap** | [`to-fix-step-order.md`](../to-fix-step-order.md) § Step 07 |
| **Depends on** | **Step 02** (`~/.speedchat` sessions persistence), **Step 03** (provider registry + authenticated chat HTTP) |
| **Out of scope** | Step 04 prompt composer profiles, Step 06 experts, Step 20 settings UI for title model (minimal config hook only) |

---

## Goal

Replace the synchronous first-line truncation in [`maybeAutoTitleFromFirstUserMessage`](../../../src/state/sessions.ts) with a **short, non-streaming** LLM title job fired on the **first user message** of a chat still named `New chat`. Titles must **not block** the main send path; the sidebar updates when the job completes. Shipped prompt lives under [`src/chat/prompts/titles/`](../../../src/chat/prompts/titles/) with optional user override under `~/.speedchat/prompts/titles/`.

---

## Current behavior (baseline)

| Location | Behavior |
|----------|----------|
| [`src/state/sessions.ts`](../../../src/state/sessions.ts) `maybeAutoTitleFromFirstUserMessage` | If `chat.name === PLACEHOLDER_CHAT_NAME` (`'New chat'`), sets `chat.name` to first **40** chars of user text (`AUTO_TITLE_MAX_LEN`) + `…` — **synchronous**, no model |
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) ~L399 | Calls heuristic before push + `renderSidebar()` on tool send path |
| [`src/api/chat.ts`](../../../src/api/chat.ts) ~L279 | Same on plain `sendMessage` path |
| [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts) | `renderSidebar()` reads `chat.name`; manual rename via inline input (max **120** chars) |
| Persistence | Today: `localStorage` `speedchat-sessions-v1` → after **Step 02**: session blob under `~/.speedchat/sessions/` (via server API) |

**Remove** calls to `maybeAutoTitleFromFirstUserMessage` from send paths once the async title hook is wired. **Delete or deprecate** the heuristic function (prefer delete + re-export nothing; tests cover replacement).

---

## Target behavior

```mermaid
sequenceDiagram
  participant User
  participant Send as sendMessageWithTools
  participant Sessions as sessions API
  participant Title as generateChatTitle
  participant LLM as Provider chat/completions
  participant Sidebar as renderSidebar

  User->>Send: First message (name = New chat)
  Send->>Sessions: push user message, save, render chat
  Send->>Title: scheduleTitleGeneration(chatId, seed) fire-and-forget
  Send->>LLM: Main stream (unchanged, not awaited by title)
  Title->>LLM: POST stream:false, max_tokens small
  LLM-->>Title: title string
  Title->>Sessions: apply if still placeholder + not user-renamed
  Title->>Sidebar: renderSidebar()
```

### Rules

1. **Trigger once per chat:** Only when `chat.name === PLACEHOLDER_CHAT_NAME` and this send adds the **first** `role: 'user'` row (history length was 0 before push). Re-sends or follow-up messages do not re-title.
2. **Non-blocking:** `scheduleChatTitleGeneration(...)` returns immediately; **never** `await` title generation inside `sendMessageWithTools` / `sendMessage` before starting the main completion.
3. **Non-streaming:** Title request uses `stream: false` (reuse pattern from [`tryNonStreamingFallback`](../../../src/api/chat.ts)).
4. **Low cost:** `max_tokens` **16–32**, `temperature` **0.2–0.4**, no tools, single user message in API payload (the seed text only).
5. **Output hygiene:** Trim, collapse whitespace, strip quotes/markdown fences, cap to `AUTO_TITLE_MAX_LEN` (40) with `…` if needed; empty/failure → leave `New chat` (optional: one-line debug log in dev).
6. **Race safety:** If the user **renamed** the chat (`chat.name !== PLACEHOLDER_CHAT_NAME`) or **deleted** the chat before the job finishes, **discard** the result (no overwrite).
7. **In-flight guard:** At most **one** title job per `chatId` at a time; duplicate schedules while job pending are no-ops.
8. **Provider:** Resolve URL + auth via **Step 03** provider layer (active chat’s provider/model or dedicated *title* model id from config — see Configuration).
9. **Persistence:** On successful apply: `touchChat`, `scheduleSaveSessions()` so **Step 02** session file updates.
10. **Sidebar:** Call `renderSidebar()` after title apply (and only then for title — avoid extra sidebar churn on failed jobs).

### Seed text

| Send path | Seed passed to title prompt |
|-----------|----------------------------|
| Tool loop ([`loop.ts`](../../../src/tools/loop.ts)) | `text \|\| validAttachments[0]?.name \|\| 'Attachment'` (existing `titleSeed`) |
| Plain ([`chat.ts`](../../../src/api/chat.ts)) | Composer `text.trim()` |

Attachments-only first message: seed is filename; prompt should still produce a sensible title.

---

## Prerequisites (must exist before implementing 07)

### From Step 02

- [ ] Session read/write API for chats (not raw `localStorage` only in production path).
- [ ] `findChatById(chatId)` or equivalent stable lookup from async callback.
- [ ] `scheduleSaveSessions()` persists to `~/.speedchat/sessions/<id>.json` (or aggregate file — match Step 02 design).

### From Step 03

- [ ] `resolveProviderForChat(chat)` or `resolveProvider(providerId)` → `{ baseUrl, headers }`.
- [ ] `completeChat(provider, body, { signal })` or shared non-streaming helper used by title module.
- [ ] API key / Bearer injection on title requests (same as main chat).

**If Step 03 is incomplete:** Implement title module against **today’s** `parseServerBaseUrl(serverUrl())` + settings URL only as a **temporary adapter** behind `TitleProviderPort` interface; swap implementation when Step 03 lands (document in code comment + migration todo in verification file).

---

## File layout (deliverables)

```
src/chat/prompts/titles/
  README.md                 # Human + sub-agent: variables, examples, override path
  default.md                # Shipped system/user template (or system.md + user.md)
  # Optional lite variant later (Step 04); not required for 07

src/chat/titles/
  prompt.ts                 # loadPrompt(), applyTemplate({ userMessage })
  generate.ts               # generateChatTitle(seed, options) → Promise<string | null>
  schedule.ts               # scheduleChatTitleGeneration(chatId, seed), in-flight Map
  sanitize.ts               # normalizeTitle(raw): string | null
  types.ts                  # TitleGenerationOptions, TitleProviderPort

src/state/sessions.ts       # remove maybeAutoTitleFromFirstUserMessage; optional applyChatTitle(chatId, name)

test/titles/
  sanitize.test.ts          # static strings, no network
  generate.test.ts          # mocked fetch / injected port
  schedule.test.ts          # race: rename, delete, duplicate schedule

documentation/plans/verification/step-07.md   # commands + expected output (implementer)
```

User overrides (Step 02 paths):

```
~/.speedchat/prompts/titles/default.md   # wins over shipped default when present
```

---

## Prompt design (`src/chat/prompts/titles/`)

### `default.md` (shipped)

- **Purpose:** Instruct a small model to output **only** a short chat title (3–8 words), no punctuation spam, no quotes, English unless user message is clearly another language.
- **Variables:** `{{userMessage}}` — first message seed (may include `[image: …]` or `<file name="…">` markers; model should infer topic).
- **Constraints in prompt:** Max ~40 characters output; no markdown; no “Title:” prefix; if unclear, use a generic but specific label (e.g. “PDF summary question”).
- **Examples block:** 2–3 few-shot lines in the markdown file (user message → title).

### `prompt.ts`

- Read bundled default via `import.meta.url` / `?raw` (Vite) **or** fetch from `/src/...` in dev — match how Step 04 loads prompts.
- Merge override from `~/.speedchat` when server exposes `GET /api/config/prompts/titles/default` (Step 02 API); else bundled only in `npm run dev`.
- `buildTitleMessages(seed: string): ApiMessage[]` → `[{ role: 'system', content }, { role: 'user', content: seed }]`.

---

## Configuration

Store in `~/.speedchat/config.json` (Step 02 schema), keys:

| Key | Default | Notes |
|-----|---------|--------|
| `titles.enabled` | `true` | Master switch |
| `titles.modelId` | `""` | Empty → use **active chat’s** `modelId` at schedule time |
| `titles.providerId` | `""` | Empty → use chat’s bound provider or app default |
| `titles.maxTokens` | `24` | Cap completion length |
| `titles.temperature` | `0.3` | |

**Step 20** will add UI; for **07** reading config from server API is enough (hardcoded defaults if file missing).

---

## API module design

### `sanitize.ts`

```ts
// Pseudocode — implementer fills in
export function normalizeTitle(raw: string): string | null
```

- Trim, replace `\s+` with space, remove wrapping `"` `'` and trailing `.`.
- Reject if length 0 or only punctuation.
- Apply `AUTO_TITLE_MAX_LEN` + ellipsis consistent with old heuristic.

### `generate.ts`

```ts
export interface TitleProviderPort {
  complete(body: ChatCompletionBody, signal?: AbortSignal): Promise<ChatCompletionChunk>;
}

export async function generateChatTitle(
  seed: string,
  options: TitleGenerationOptions,
  port: TitleProviderPort
): Promise<string | null>
```

- Build messages from `buildTitleMessages(seed)`.
- `POST .../chat/completions` with `stream: false`.
- Parse via existing `extractMessageText(choices[0].message)`.
- Return `normalizeTitle(text)` or `null` on HTTP/parse failure.
- **Abort:** dedicated `AbortController` per job; abort on chat delete (optional hook from `removeChatById`).

### `schedule.ts`

```ts
const inflight = new Map<string, AbortController>();

export function scheduleChatTitleGeneration(chatId: string, seed: string): void
```

1. Load config; if `!titles.enabled` return.
2. If `inflight.has(chatId)` return.
3. `findChatById`; if missing or `name !== PLACEHOLDER_CHAT_NAME` return.
4. Create `AbortController`, store in `inflight`.
5. `void runTitleJob(chatId, seed, ac.signal).finally(() => inflight.delete(chatId))`.

`runTitleJob`:

1. Resolve provider + model.
2. `const title = await generateChatTitle(seed, opts, port)`.
3. Re-fetch chat; if gone or renamed → return.
4. `chat.name = title`; `touchChat`; `scheduleSaveSessions()`; `renderSidebar()`.

### `sessions.ts` changes

- **Remove** `maybeAutoTitleFromFirstUserMessage`.
- **Add** (optional, keeps race logic testable):

```ts
export function applyGeneratedChatTitle(chatId: string, title: string): boolean
```

Returns `false` if chat missing or `name !== PLACEHOLDER_CHAT_NAME`; else sets name and returns `true`.

### Send path integration

| File | Change |
|------|--------|
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) | After first user message pushed: `scheduleChatTitleGeneration(chat.id, titleSeed)` — **remove** `maybeAutoTitleFromFirstUserMessage` |
| [`src/api/chat.ts`](../../../src/api/chat.ts) | Same for plain path |
| [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts) | No change required unless adding subtle “Naming…” state (optional, **not** required for PASS) |

**Do not** call `renderSidebar()` solely for title scheduling; only after title applied (main send may still call `renderSidebar()` once as today).

---

## Testing strategy

Add **`npm test`** script in Step 02 or here if missing:

```json
"test": "tsx --test test/**/*.test.ts"
```

(devDependency: `tsx` if not already present from Step 02).

### Principles

- **Mock the model**, not LM Studio: inject `TitleProviderPort` returning static JSON chunks.
- **Fixed IDs:** `chatId = '11111111-1111-1111-1111-111111111111'`.
- **Static expected strings** for sanitize and successful generation.

### `test/titles/sanitize.test.ts`

| Case | Input | Expected |
|------|--------|----------|
| Plain | `"  Hello World  "` | `"Hello World"` |
| Quoted | `'"Fix bug in sidebar"'` | `"Fix bug in sidebar"` |
| Long | 80-char string | 40 chars + `…` |
| Empty | `"   "` | `null` |
| Markdown fence | `` ```foo``` `` | sanitized title or `null` per rules |

### `test/titles/generate.test.ts`

- Mock port returns `{ choices: [{ message: { content: "Redis cache tuning" } }] }`.
- Assert `generateChatTitle('How do I tune Redis?...', opts, port) === 'Redis cache tuning'`.
- Mock HTTP error → `null`.
- Assert request body includes `stream: false`, `max_tokens` from options, **no** `tools` key.

### `test/titles/schedule.test.ts`

Use minimal in-memory session stub or mock `sessions` module:

1. Chat with `name: 'New chat'`, schedule → after microtask/mock resolve, `name` updated.
2. User renamed to `"My thread"` before resolve → name stays `"My thread"`.
3. Two schedules same `chatId` → mock `complete` called **once**.
4. `titles.enabled: false` → `complete` never called.

### Manual verification ([`documentation/plans/verification/step-07.md`](../verification/step-07.md))

1. `npm start` → new chat → send first message → sidebar still shows `New chat` briefly, then model title within a few seconds.
2. Rename before title returns → generated title does **not** apply.
3. Second message in same chat → title unchanged.
4. Plain send path (if still reachable) behaves the same.
5. Offline / LM Studio down → chat send still works; title stays `New chat`.

---

## Acceptance criteria (verifier)

- [ ] `maybeAutoTitleFromFirstUserMessage` removed; no grep hits in `src/`.
- [ ] Shipped prompt under `src/chat/prompts/titles/` + README documents override path.
- [ ] Title job is **async** and **non-streaming**; main send does not await it.
- [ ] First message only; placeholder name only; race-safe against rename/delete.
- [ ] Session persistence updated on success (Step 02 path).
- [ ] `npm test` (or documented `npx tsx --test ...`) passes all `test/titles/*`.
- [ ] [`documentation/context.md`](../../context.md) updated: title generation section, config keys, prompt path.
- [ ] Implementer created [`documentation/plans/verification/step-07.md`](../verification/step-07.md); verifier re-runs and reports PASS/FAIL.

---

## Implementation todos

### Phase 0 — Readiness

- [ ] **0.1** Confirm Step 02 session API and Step 03 provider resolution are merged (or document adapter shim).
- [ ] **0.2** Read [`documentation/context.md`](../../context.md), [`to-fix-step-order.md`](../to-fix-step-order.md) Step 07, current send paths in [`loop.ts`](../../../src/tools/loop.ts) and [`chat.ts`](../../../src/api/chat.ts).
- [ ] **0.3** Add `documentation/plans/verification/step-07.md` stub (commands TBD).

### Phase 1 — Prompt assets

- [ ] **1.1** Create `src/chat/prompts/titles/README.md` (variables, override dir, examples).
- [ ] **1.2** Create `src/chat/prompts/titles/default.md` with system instructions + `{{userMessage}}` + few-shot examples.
- [ ] **1.3** Implement `src/chat/titles/prompt.ts` — load bundled + optional override, `buildTitleMessages(seed)`.

### Phase 2 — Core generation

- [ ] **2.1** Create `src/chat/titles/types.ts` (`TitleGenerationOptions`, `TitleProviderPort`).
- [ ] **2.2** Implement `src/chat/titles/sanitize.ts` + unit tests `test/titles/sanitize.test.ts`.
- [ ] **2.3** Implement `src/chat/titles/generate.ts` using `TitleProviderPort` + `extractMessageText`.
- [ ] **2.4** Wire `TitleProviderPort` production adapter to Step 03 provider `completeChat` (or interim `tryNonStreamingFallback` wrapper).
- [ ] **2.5** Unit tests `test/titles/generate.test.ts` with mocked port.

### Phase 3 — Scheduling and session apply

- [ ] **3.1** Implement `src/chat/titles/schedule.ts` with `inflight` map and `scheduleChatTitleGeneration`.
- [ ] **3.2** Add `applyGeneratedChatTitle` in [`sessions.ts`](../../../src/state/sessions.ts) (or keep logic inside schedule module calling session helpers only).
- [ ] **3.3** Read `titles.*` from `~/.speedchat/config.json` via Step 02 config API with safe defaults.
- [ ] **3.4** Unit tests `test/titles/schedule.test.ts` (rename race, duplicate guard, disabled config).
- [ ] **3.5** **Remove** `maybeAutoTitleFromFirstUserMessage` from [`sessions.ts`](../../../src/state/sessions.ts).

### Phase 4 — Integration

- [ ] **4.1** [`loop.ts`](../../../src/tools/loop.ts): detect first user message; call `scheduleChatTitleGeneration`; remove heuristic + avoid duplicate sidebar render for title only.
- [ ] **4.2** [`chat.ts`](../../../src/api/chat.ts) plain path: same integration.
- [ ] **4.3** Optional: abort title job in `removeChatById` when chat deleted.
- [ ] **4.4** Add `"test"` script to [`package.json`](../../package.json) if not present from Step 02.

### Phase 5 — Docs and verification

- [ ] **5.1** Update [`documentation/context.md`](../../context.md) — programmatic titles, paths, config, async behavior.
- [ ] **5.2** Complete [`documentation/plans/verification/step-07.md`](../verification/step-07.md) with exact test + manual commands.
- [ ] **5.3** Run full test suite locally; fix failures.
- [ ] **5.4** Manual smoke per verification file with `npm start`.

### Phase 6 — Verifier handoff

- [ ] **6.1** Verifier (separate agent) re-runs tests + manual checklist → PASS/FAIL report.
- [ ] **6.2** On FAIL: implementer fixes; no step closure until PASS or user waiver.

---

## `context.md` update checklist (implementer)

Add subsection under **Multi-chat sessions**:

- Title generation trigger (first message, placeholder name).
- Async non-streaming job; does not block send.
- Prompt path `src/chat/prompts/titles/` + `~/.speedchat/prompts/titles/` override.
- Config keys `titles.enabled`, `titles.modelId`, `titles.providerId`.
- Remove description of first-line truncation heuristic.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Title job slows LM Studio | Small `max_tokens`, optional dedicated small model in config |
| User sees `New chat` for seconds | Acceptable per spec; optional future: ephemeral “Naming…” label |
| Provider errors | Fail silent; keep placeholder name |
| Duplicate titles on race | `inflight` map + re-check `PLACEHOLDER_CHAT_NAME` before apply |
| `npm run dev` without server | Overrides may be unavailable; bundled prompt still works; config defaults in browser cache if Step 02 defines it |

---

## References

| Source | Use |
|--------|-----|
| [OpenCode](https://github.com/anomalyco/opencode) | Session naming / sidecar tasks pattern |
| [`src/api/chat.ts`](../../../src/api/chat.ts) `tryNonStreamingFallback` | Non-streaming POST shape |
| [`documentation/plans/to-fix-step-order.md`](../to-fix-step-order.md) | Wave 3 prompt tree includes `titles/` |
| [`src/constants.ts`](../../../src/constants.ts) | `PLACEHOLDER_CHAT_NAME`, `AUTO_TITLE_MAX_LEN` |

---

## Sub-agent handoff (copy-paste)

**Implementer:** Execute phases 0–5 above. Depends on Step **02** + **03**. Do not implement Step 04 composer, Step 06 experts, or Step 20 settings UI. Must delete `maybeAutoTitleFromFirstUserMessage` and add mocked tests.

**Verifier:** Acceptance criteria section only; run `documentation/plans/verification/step-07.md`; report PASS/FAIL.
