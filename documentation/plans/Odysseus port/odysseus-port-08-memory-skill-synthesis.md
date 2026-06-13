# Odysseus Port 08 — Memory Synthesis And Skill Auto-Learning

Tier: 2  
Effort: M  
Priority: Medium  
Status: Shipped (MIN-127)  
Depends on: #1 and #13  
Linear: [MIN-127](https://linear.app/minnowai/issue/MIN-127/odysseus-port-08-memory-synthesis-and-skill-auto-learning)

## Goal

Let Minnow propose durable memories and reusable skills from completed conversations without automatically polluting the user's memory store. The default behavior should be "suggest and confirm," not silent learning.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#1** (semantic dedup), **#13** (untrusted excerpts in review UI), **#4** recommended (utility-role model binding) |
| npm packages | None |
| LLM access | Utility-role provider/model for extraction calls |
| Estimated effort | 4–6 days |

## Prerequisites & Deliverables

| Deliverable | Description |
|-------------|-------------|
| Proposal stores | `~/.minnow/memory/proposals.json`, `~/.minnow/skills/proposals.json` |
| Synthesis modules | Fact + skill extractors with strict JSON prompts |
| Post-turn hook | Async trigger in `src/tools/loop.ts` after normal completion |
| Review UI | Accept/edit/reject in Memory settings or notification panel |
| Accept flow | `createEntry()` + `saveUserSkillContent()` |
| Tests | Parser edge cases, secret rejection, state transitions |

## Verified Source Context

- Odysseus references:
  - `services/memory/memory_extractor.py` — `extract_and_store()`, `EXTRACT_SYSTEM_PROMPT`
  - `services/memory/skill_extractor.py` — `maybe_extract_skill()`, `MIN_CONFIDENCE=0.6`
  - Categories: `identity|preference|fact|contact|project|goal`
  - Cadence: every 4th message pair; skills when `round_count >= 2` OR `tool_count >= 2`
- Minnow memory: `server/memory/store.js` → `createEntry()`.
- Minnow skills: `server/skills/user-skills.js` → `saveUserSkillContent()`, `createUserSkill(projectRoot, id, label)`.
- Chat completion hook: `src/tools/loop.ts` → `completedNormally` path (not `/api/generations` proxy).
- Sub-agent reference: `src/agents/sub-agent-structured-outcome.ts`.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/memory/synthesis.js` | LLM fact extraction prompt + parser |
| `server/memory/proposals.js` | Proposal CRUD persistence |
| `server/memory/skill-synthesis.js` | Skill draft extraction |
| `server/skills/proposals.js` | Skill proposal persistence |
| `server/memory/synthesis-routes.js` | API for list/accept/reject |
| `src/ui/memory-proposals-panel.ts` | Review UI |
| `src/synthesis/client.ts` | Client API wrapper |
| `test/memory/synthesis-parse.test.mjs` | JSON parser edge cases |
| `test/memory/proposals.test.mjs` | Accept/reject state machine |
| `test/skills/skill-synthesis.test.mjs` | SKILL.md validation |

## Files to Modify

| Path | Change |
|------|--------|
| `src/tools/loop.ts` | Post-turn async synthesis hook |
| `server/config/home.js` | `synthesis` config defaults |
| `src/ui/settings-sections.ts` | Proposals panel in Memory section |
| `documentation/context.md` | Document synthesis behavior |

## Config Schema

```json
{
  "synthesis": {
    "enabled": true,
    "requireConfirmation": true,
    "confidenceThreshold": 0.6,
    "maxProposalsPerTurn": 3,
    "throttleMessagePairs": 4,
    "skillMinRounds": 2,
    "skillMinToolCalls": 2,
    "utilityProviderId": "",
    "utilityModelId": ""
  }
}
```

## Data Model

```ts
interface MemoryProposal {
  id: string;
  createdAt: string;
  sourceChatId?: string;
  sourceExcerpt?: string;  // for review UI — treat as private
  title: string;
  body: string;
  tags: string[];
  category: 'identity' | 'preference' | 'fact' | 'contact' | 'project' | 'goal';
  confidence: number;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface SkillProposal {
  id: string;
  createdAt: string;
  sourceChatId?: string;
  title: string;
  skillMdDraft: string;  // full SKILL.md with front matter
  tags: string[];
  confidence: number;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
}
```

Cap pending proposals: 100 total; prune oldest rejected after 30 days (configurable).

## API Routes

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/memory/proposals` | `?status=pending` |
| POST | `/api/memory/proposals/:id/accept` | Body: optional `{ title, body, tags }` edits |
| POST | `/api/memory/proposals/:id/reject` | |
| GET | `/api/skills/proposals` | |
| POST | `/api/skills/proposals/:id/accept` | Body: optional `{ skillMdDraft }` edits |
| POST | `/api/skills/proposals/:id/reject` | |

## Detailed Implementation Phases

### Phase 1 — Proposal persistence (1 day)

1. `server/memory/proposals.js` + `server/skills/proposals.js`:
   - Atomic JSON read/write.
   - `addProposal()`, `listProposals(status)`, `updateStatus()`, `capPending()`.
2. Routes in `server/memory/synthesis-routes.js`.
3. Tests: cap enforcement, accept/reject transitions, duplicate accept rejected.

### Phase 2 — Fact synthesis (1.5 days)

1. `server/memory/synthesis.js`:
   - Port `EXTRACT_SYSTEM_PROMPT` intent from Odysseus.
   - Input: last N message pairs (CONTEXT_WINDOW: 6).
   - Output: strict JSON array `[{ title, body, tags, category, confidence, rationale }]`.
   - Reject if contains patterns: API keys, passwords, tokens, `sk-`, `Bearer `.
   - Dedupe against existing memory via #1 semantic search when available; else keyword.
2. Parser: handle malformed JSON, stray braces (port Odysseus `test_skill_extractor_stray_brace`).
3. Non-streaming LLM call via utility provider (#4 `utility` role or config override).
4. Tests: valid JSON, malformed, secret rejection fixtures.

### Phase 3 — Post-turn hook (1 day)

1. In `src/tools/loop.ts`, after `completedNormally`:
   - Skip if: cancelled, empty response, tool-only failure, benchmark/compare/eval modes.
   - Increment message-pair counter per chat (persist in chat metadata or module state).
   - Throttle: only run every `throttleMessagePairs` pairs.
   - Fire async `POST /api/memory/synthesis/run` (non-blocking) with chat id + recent messages excerpt.
2. Server endpoint runs synthesis + writes proposals.
3. Optional: badge in UI when pending proposals exist.

### Phase 4 — Review UI (1 day)

1. `src/ui/memory-proposals-panel.ts` in Memory settings:
   - List pending memory + skill proposals.
   - Show excerpt, confidence, rationale.
   - Accept (with inline edit), Reject buttons.
   - Wrap excerpts display with #13 awareness (user-private).
2. Notification hook: `noteAgentMessage` when new proposals arrive (optional).

### Phase 5 — Accept flows (0.5 day)

1. Accept memory → `createEntry()` with `source: 'agent'` → #1 embeds vector.
2. Accept skill → validate YAML front matter → `createUserSkill(getAppRoot(), id, label)` → `saveUserSkillContent()`.
3. Mark proposal `accepted`; do not re-surface.

### Phase 6 — Skill synthesis (1 day)

1. `server/memory/skill-synthesis.js`:
   - Gate: `round_count >= skillMinRounds` OR `tool_count >= skillMinToolCalls`.
   - Detect repeated procedures or explicit "next time do it this way" guidance.
   - Draft `SKILL.md` with front matter (`name`, `description`, `triggers`).
   - Confidence floor 0.6 (configurable).
2. Default to pending only; never auto-save.

### Phase 7 — Tidy/audit (deferred)

- Consolidate duplicate memories.
- Flag stale proposals.
- Keep disabled until proposal queue proves useful.

## Implementation TODOs

- [x] Add `server/memory/synthesis.js` for fact proposal generation
- [x] Add `server/memory/proposals.js` for proposal persistence
- [x] Add `server/memory/skill-synthesis.js` for skill proposal generation
- [x] Add API routes for listing, accepting, editing, and rejecting proposals
- [x] Add a post-turn hook near the `completedNormally` completion path in `src/tools/loop.ts`
- [x] Add throttling similar to Odysseus's every-fourth-message-pair extraction cadence
- [x] Gate skill synthesis when `round_count >= 2` or `tool_count >= 2`; do not require both
- [x] Pass `getAppRoot()` into `createUserSkill(projectRoot, id, label)` when accepting skill proposals
- [x] Add an explicit deferred phase for LLM memory tidy/audit/consolidation
- [x] Add settings: enabled, confirmation required, confidence threshold, max proposals per turn
- [x] Add a review UI in Memory settings or a small notifications-backed panel
- [x] Ensure accepted facts call `createEntry()` and accepted skills call `saveUserSkillContent()`
- [x] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_memory_extraction_parse.py` | `test/memory/synthesis-parse.test.mjs` |
| `tests/test_skill_extractor_stray_brace.py` | skill parser |
| `tests/test_skill_extractor_json.py` | skill parser |
| `tests/test_consolidate_memory_explicit_drops.py` | deferred tidy phase |

## Acceptance Criteria

- A fact-rich completed turn can create a pending memory proposal.
- Accepting a memory proposal creates a normal memory entry.
- Rejecting a proposal prevents it from being injected.
- A repeated procedure can create a pending skill proposal.
- Accepted skill drafts are valid user skills under `~/.minnow/skills/`.
- No secrets are synthesized into memory or skill proposals.

## Verification

- Add tests for proposal persistence and accept/reject state transitions
- Add prompt-output parser tests for valid JSON, malformed JSON, and secret rejection
- Manual: discuss a stable project convention, accept the proposal, start a new chat, and confirm retrieval
- Manual: repeat a procedure twice, confirm a skill proposal appears, edit it, and save it

## Risks And Guardrails

- Noise is the main product risk; default to confirmation and conservative confidence thresholds.
- Synthesis adds LLM cost; make it configurable and preferably utility-role bound.
- All source conversation excerpts shown in review UI should be treated as user-private data.
- Do not auto-save skills without explicit user acceptance.
