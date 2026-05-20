# Fix chat titles leaking thinking text

**Summary:** Stop auto-generated sidebar titles from using model reasoning / “thinking” channels so names reflect the user’s topic, not internal monologue.

**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) — line 7

---

## Problem statement

Nearly all auto titles collapse to phrases like **“here's a thinking process”** — the opening line of the model’s reasoning trace on reasoning-capable models. Sidebar threads become indistinguishable and unprofessional.

---

## Current behavior

| Step | Behavior | Key paths |
|------|----------|-----------|
| Trigger | First user message schedules async title job | `scheduleChatTitleGeneration` in `src/chat/titles/schedule.ts`; called from `src/tools/loop.ts`, `src/api/chat.ts` |
| Seed | User message text passed as `seed` | `schedule.ts` `runTitleJob` |
| API call | Non-streaming completion, small `max_tokens` | `src/chat/titles/generate.ts` |
| Text extraction | `extractMessageText` then **`extractReasoningMessage` fallback** | `generate.ts` `extractTitleCompletionText` (lines 12–17) |
| Normalize | Strip fences, `Title:` prefix, length cap | `src/chat/titles/sanitize.ts` |
| Prompt | “Output only the title”; examples in bundled prompt | `src/chat/prompts/titles/default.md` |
| Provider | Uses same model as chat (often reasoning model) | `createTitleProviderPort`, titles config |

**Root cause:** Reasoning models often return **empty `content`** and put the full chain-of-thought in `reasoning` / `reasoning_content`. The title path intentionally prefers reasoning when content is empty (`test/titles/generate.test.mjs` — “uses reasoning field when content is empty”), which copies thinking prose into the sidebar title.

`normalizeTitle` does not strip thinking boilerplate (“here's a thinking process”, “let me”, etc.).

---

## Proposed solution

### 1. Never use reasoning for titles (primary fix)

In `extractTitleCompletionText`:

- Return **only** `extractMessageText(message).trim()`.
- Remove fallback to `extractReasoningMessage`.
- If content empty → `generateChatTitle` returns `null` → title stays placeholder until retry or manual rename.

Update test `uses reasoning field when content is empty` → expect `null` instead.

### 2. Harden sanitize (secondary)

In `normalizeTitle`:

- Reject titles matching known thinking openers (case-insensitive), e.g. `/^here'?s (a )?thinking/i`, `/^let me (think|analyze)/i`.
- Reject if title length > 60 and contains no user-topic signal (optional heuristic).

### 3. Prompt + request params

In `default.md`:

- Add: “Never output reasoning, analysis, or ‘thinking process’ phrasing.”
- “If you cannot produce a title from the user message alone, output exactly: `UNTITLED`” (map `UNTITLED` → null in sanitize).

Optional API flags (if LM Studio supports for title model):

- Disable reasoning on title completion request in `provider-port.ts` (model-specific `reasoning_effort: none` or equivalent — verify against LM Studio API).

### 4. Fallback title

When generation returns null:

- Keep placeholder `New chat` / existing placeholder logic (`isPlaceholderChatName` in `placeholder.ts`).
- Optional: truncate **user seed** to 40 chars as deterministic fallback (no LLM).

---

## Implementation todos

- [ ] Remove reasoning fallback in `src/chat/titles/generate.ts`
- [ ] Update `test/titles/generate.test.mjs` expectations
- [ ] Add sanitize guards for thinking phrases + `UNTITLED`
- [ ] Update `src/chat/prompts/titles/default.md`
- [ ] (Optional) User-seed truncation fallback in `schedule.ts` when LLM returns null
- [ ] (Optional) Provider port: disable reasoning for title request
- [ ] Add `test/titles/sanitize.test.mjs` cases for rejected thinking strings
- [ ] Manual QA with reasoning model — titles show topic words from user message or seed fallback

---

## Files to change

| File | Change |
|------|--------|
| `src/chat/titles/generate.ts` | Drop reasoning extraction |
| `src/chat/titles/sanitize.ts` | Reject thinking patterns |
| `src/chat/prompts/titles/default.md` | Stricter rules |
| `src/chat/titles/schedule.ts` | Optional seed fallback |
| `src/chat/titles/provider-port.ts` | Optional reasoning off |
| `test/titles/generate.test.mjs` | Update tests |
| `test/titles/sanitize.test.mjs` | New cases |

---

## Testing plan

1. Mock port: `{ content: '', reasoning: "Here's a thinking process…" }` → title not applied (null).
2. Mock port: `{ content: 'Redis cache tuning' }` → sidebar updated.
3. Sanitize: `"Here's a thinking process for your request"` → null.
4. Live: send first message with reasoning model — sidebar shows topic, not thinking.
5. Regression: title still schedules once per chat; inflight abort on delete still works.

---

## Risks / open questions

- **Empty content rate:** More null titles — seed fallback recommended.
- **Non-English thinking openers:** May need i18n list or rely on null content only.
- **Breaking test:** Existing test explicitly wanted reasoning fallback — intentional removal.
- **Retitle existing chats:** No migration; user rename only (out of scope).
