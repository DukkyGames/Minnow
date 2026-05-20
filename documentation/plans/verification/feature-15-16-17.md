# Verification — Feature 15–16–17 (C2 message actions)

| Field | Value |
|-------|-------|
| **Plan** | [`documentation/plans/Build out/feature-15-16-17-message-actions.md`](../Build%20out/feature-15-16-17-message-actions.md) |
| **Backlog** | [`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § C2 |
| **Depends on** | C1 [`feature-14-stop-generation`](../Build%20out/feature-14-stop-generation.md) |
| **Verifier** | Plan review (2026-05-20) |

---

## Result

| Gate | Result | Notes |
|------|--------|-------|
| **Plan review** (backlog C2 + per-agent template) | **PASS** | Plan updated 2026-05-20; see § Plan review |
| **Implementation sign-off** | **PASS** | Shipped 2026-05-20: truncate/resend/menu + tests; `npm run build` + targeted tests green |

**Overall for this verification pass:** **PASS** (plan + automated implementation).

Implementers: flip implementation sign-off to **PASS** only when § Automated gates and § Manual UAT are fully checked and backlog AC1–AC10 hold in a running build.

---

## Plan review (backlog C2 + template)

### Per-agent deliverable template

| # | Required | Present in plan | Status |
|---|----------|-----------------|--------|
| 1 | Problem + optional mock | Summary, Goals, Current state (research) | ✓ |
| 2 | Exact file change list | § Files to touch | ✓ |
| 3 | Schema/API changes + migration | § Schema / API changes (added); § API design | ✓ |
| 4 | Acceptance criteria (+ edge cases) | AC1–AC10; backlog traceability table | ✓ |
| 5 | Test plan (`npm test` + manual QA) | Phases 1–6; § Manual test plan | ✓ |
| 6 | Todos checklist | Phases 0–7; § Todos (execution checklist) | ✓ |

### Backlog § C2 alignment

| Backlog requirement | Plan mapping | Status |
|---------------------|--------------|--------|
| ⋮ menu: Edit, Regenerate from here, Delete, Copy, Remake | Phases 3–4, AC1–AC6 | ✓ |
| `truncateChatHistory(chatId, index)` | `truncateChatHistory` + `mode` inclusive/exclusive | ✓ (extended API documented) |
| `resendFromIndex()` in `loop.ts` / `sessions.ts` | `resend-from-index.ts` + `runChatTurn`; optional `sessions` re-export | ✓ |
| Atomic assistant + tool_results truncation | `expandAtomicRange`, `normalizeHistoryTail`, AC7–AC8 | ✓ |
| Regenerate removes subsequent messages (UI + persistence) | AC4–AC6, manual 3–5 | ✓ |
| Tool-call chains consistent | AC7–AC8, manual 6–8 | ✓ |
| Undo not required v1 | Goals § v1 scope | ✓ |
| Depends on C1 | Phase 0, AC9 | ✓ |
| Size L | Metadata table | ✓ |

### Plan fixes applied (2026-05-20)

- Resolved CSS path: `src/styles/message-actions.css` (was inconsistent in architecture table).
- Completed Phase 2.4 test bullets.
- Added § Schema / API changes, § Backlog traceability, § Verification artifact, disambiguation vs C3 `feature-17-chat-scroll`.
- Linked this verification doc from plan Phase 7.

### Plan review notes (non-blocking)

- `indexOfLastUserMessage` is private in `loop.ts` today — export or share helper when implementing remake/regenerate.
- C1 (`stopGeneration`) not merged yet; Phase 0 remains a hard gate.

---

## Automated gates (implementation)

```bash
npm run build
npm test
node --import tsx --import ./test/test-loader.mjs --test test/chat/history-truncate.test.mts test/chat/resend-from-index.test.mts
node --test test/ui/message-actions.test.mjs
```

| # | Check | Pass |
|---|-------|------|
| A1 | `npm run build` exits 0 | ✓ |
| A2 | `npm test` full suite green | ✓ |
| A3 | `history-truncate.test.mts` — atomic tool range, inclusive/exclusive, tail normalize | ✓ |
| A4 | `resend-from-index.test.mts` — no duplicate user row, guards, skill tag | ✓ |
| A5 | `message-actions.test.mjs` — menu semantics (`aria-haspopup`) | ✓ |

---

## Acceptance criteria (plan AC1–AC10)

| AC | Criterion | Pass |
|----|-----------|------|
| AC1 | ⋮ on user/assistant turns; `aria-haspopup="menu"` | ☐ |
| AC2 | Copy to clipboard; tool-only rows not menu-targeted | ☐ |
| AC3 | Edit user: truncate after, composer edit, send replaces row + new reply | ☐ |
| AC4 | Delete: selected turn + all following removed (UI + persistence) | ☐ |
| AC5 | Regenerate (user): truncate after user, resend without duplicate user row | ☐ |
| AC6 | Regenerate / Remake (assistant): truncate assistant block, resend from preceding user | ☐ |
| AC7 | Truncating assistant+tools removes whole atomic block | ☐ |
| AC8 | `buildApiMessages` matches rendered history after regenerate | ☐ |
| AC9 | Actions blocked while `streaming`; copy allowed; stop then regenerate works (C1) | ☐ |
| AC10 | `npm run build` + `npm test` pass | ☐ |

---

## Manual UAT

| ID | Steps | Expected | Pass |
|----|-------|----------|------|
| U1 | Copy on user and assistant messages | Full text on clipboard; status “Copied” | ☐ |
| U2 | Edit user mid-thread | Single updated user row; messages below gone; new assistant reply | ☐ |
| U3 | Delete user (with confirm if applicable) | User + following removed; reload preserves truncation | ☐ |
| U4 | Regenerate from user message | Later messages removed; new stream; no duplicate user bubble | ☐ |
| U5 | Remake after tool run | Tools + assistant removed; same user prompt re-run | ☐ |
| U6 | Menu on tool card area | Same index as parent assistant; delete removes full tool chain | ☐ |
| U7 | During stream | Destructive actions blocked; copy works; after C1 stop, regenerate works | ☐ |
| U8 | DevTools / debug | Post-regenerate API payload has no orphan `tool` messages | ☐ |
| U9 | Switch chat | Actions affect active chat only | ☐ |

---

## Sign-off record

| Date | Plan review | Implementation (automated) | Commit |
|------|-------------|------------------------------|--------|
| 2026-05-20 | **PASS** | **PASS** | `618f7c3` |
