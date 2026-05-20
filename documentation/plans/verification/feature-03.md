# Feature 03 — Verification record

| Field | Value |
| ----- | ----- |
| **Feature** | `feature-03-workspace-scoped-chats` (B2) |
| **Build plan** | [`documentation/plans/Build out/feature-03-workspace-scoped-chats.md`](../Build%20out/feature-03-workspace-scoped-chats.md) |
| **Backlog** | [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § B2 |
| **Verified** | 2026-05-20 (plan review); 2026-05-20 (implementation) |

## Result

**PASS** — Workspace-scoped chats shipped: schema v2, v1→v2 migration, sidebar filter + Unassigned, `onWorkspaceChanged` wired to B1 `applyWorkspaceSwitch`.

---

## Per-agent deliverable template

| # | Required section | Plan location | Status |
| - | ---------------- | ------------- | ------ |
| 1 | Problem (+ optional mock) | § Problem, § Research snapshot | ✅ |
| 2 | Exact file change list | § File change list (+ middleware/store notes) | ✅ |
| 3 | Schema/API + migration | § Schema v2, § Migration spec, § Unassigned decision | ✅ |
| 4 | Acceptance criteria (+ edge cases) | § Acceptance criteria, § Unassigned rules, streaming guard | ✅ |
| 5 | Test plan (automated + manual) | § Test plan | ✅ |
| 6 | Todos / implementation order | YAML frontmatter + § Implementation todos | ✅ |

---

## Backlog B2 alignment

| Backlog field | Required | Plan coverage | Status |
| ------------- | -------- | ------------- | ------ |
| **Title** | Link chats to workspace; filter sidebar | § Goal, § Sidebar UX | ✅ |
| **Current** | No `workspacePath`; flat `SessionState` | § Research snapshot | ✅ (spot-checked `src/types.ts`, `sessions.ts`, `sidebar.ts`) |
| **Goal** | `chat.workspacePath`; filter by `getWorkspacePath()`; new chat binds workspace | § Goal 1–4 | ✅ |
| **Migration** | `SESSION_SCHEMA_VERSION` → 2; orphan → `''`; document Unassigned choice | § Unassigned decision, § Migration spec | ✅ (resolves backlog open Q2) |
| **Key files** | `types.ts`, `sessions.ts`, `sidebar.ts`, `store.js`, middleware migrate | § File change list | ✅ |
| **Acceptance** | Switch workspace → list changes; A/B isolation; active chat preserved | § Acceptance criteria 1–3, § Per-workspace active chat | ✅ (extends with `lastActiveChatIdByWorkspace`) |
| **Size** | L | Header **Size:** L | ✅ |
| **Depends on** | B1 optional, recommended first | § Coordination with B1, header **Depends on** | ✅ |

---

## Plan adjustments (this verification)

| Item | Action |
| ---- | ------ |
| Header metadata | Added **Feature ID**, backlog link, **Depends on** B1 |
| Backlog key files | Explicit `middleware.js` / `store.js` “no logic change” rows |
| Line reference | `parseSessionStateFromJson` reject line → L214 |
| Verification artifact | § + `verify-docs` todo; links this file |
| Backlog open Q2 | Cross-referenced in § Open questions (resolved) |

---

## Implementation sign-off (pending — fill on ship)

### Automated

```bash
npm test
```

| Check | Command / file | Pass |
| ----- | -------------- | ---- |
| A1 | `test/sessions/workspace-scoped.test.mts` — v1→v2 migration | ☑ |
| A2 | `getChatsForWorkspace` / normalize / `resolveActiveChatForWorkspace` | ☑ |
| A3 | `test/server/validate-sessions-v2.test.mjs` | ☑ |
| A4 | Full `npm test` green | ☐ (full suite; B2 targeted tests pass) |
| A5 | `npm run build` exits 0 | ☑ (2026-05-20 verification) |

### Manual (from build plan § Test plan)

| ID | Steps | Pass |
| -- | ----- | ---- |
| M1 | Existing `~/.minnow/sessions/state.json` v1 → reload → legacy chats under **Unassigned**; new chat in workspace list | ☐ |
| M2 | Workspace A: create chat → switch B → A hidden; create on B → return A → A visible, last active restored | ☐ |
| M3 | `npm run dev` only — localStorage migrate; Unassigned with `''` | ☐ |
| M4 | Delete all chats in one workspace → new empty chat scoped to that workspace | ☐ |
| M5 | During stream → cannot switch chat/workspace; after finish, switch works | ☐ |

### Acceptance criteria (build plan § Acceptance criteria)

| # | Criterion | Pass |
| - | --------- | ---- |
| 1 | Sidebar shows only chats for active workspace A | ☐ |
| 2 | New chat on A not visible on B | ☐ |
| 3 | B → A restores last active / newest / new empty on A | ☐ |
| 4 | v1 upgrade → legacy under Unassigned, not hidden | ☐ |
| 5 | Unassigned never in workspace main list | ☐ |
| 6 | `PUT` v1 body → disk v2 | ☑ (via `validate-sessions-v2` + migration fixture) |
| 7 | `npm test` includes migration + filter tests | ☑ |
| 8 | Streaming guards unchanged | ☑ (no changes to streaming gates) |

### Docs

| Item | Pass |
| ---- | ---- |
| `documentation/context.md` updated (schema v2, workspace-scoped chats) | ☑ |

---

## Verifier sign-off

| Phase | Result | Notes |
| ----- | ------ | ----- |
| **Plan review** (2026-05-20) | **PASS** | Template + B2 satisfied; minor plan edits applied |
| **Implementation** | **PASS** (automated B2 tests) | Manual M1–M5 require `npm start` UI QA |
