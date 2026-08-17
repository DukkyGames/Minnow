# Issues app v2

Design brief plus the as-built record for Phases 0–2. Phases 3–5 are unbuilt.

The brief (§1–14) is the confirmed output of `/impeccable shape`. Section 15 records
what Phase 0 landed; §16 Phase 1; §17 Phase 2. Read those before starting Phase 3 —
some open questions are now closed and some of the brief's assumptions about the
codebase turned out to be wrong.

---

## 1. Context

The Issues app shipped as MIN-261: a local, single-player tracker at `~/.minnow/issues/state.json`, with a list view, a status kanban, a detail slide-over, five `issue_*` agent tools, and a Debug-mode pipeline that can investigate, plan, and hand work to an Orchestrator board.

It works, but it stops well short of the surface it's modelled on, and the gaps are structural rather than cosmetic:

| Gap | Evidence |
|---|---|
| No assignee, no comments, no activity log, no hierarchy, no ordering | `IssueCard` in `src/types.ts` — `notes?: string` was the only comment-shaped field; parent/sub-issue existed only as `IssueRelationKind` values rendered as a flat `<ul>` |
| No shared context-menu primitive | ~13 surfaces hand-roll their own; `file-tree-context-menu.ts` and `git-graph-context-menu.ts` independently redefine the same `MenuItemDef` + `bindDismissOnce` block |
| No global command palette | `Ctrl+P` / `Ctrl+Shift+P` were documented in `shell-keyboard-help.ts` with **zero implementation**. Only `scc-palette.ts` existed, scoped to Source Control |
| GitHub issue "links" are dead text | Zero `gh issue` calls exist anywhere. You paste a URL, it becomes a chip with no title and no state (`src/chat/issues/git-actions.ts`) |
| Agent runs get no isolation and can't ask questions | `runIssueInvestigate` / `runIssuePlanBackground` (`src/chat/issues/pipeline.ts`) create a plain chat with no `worktreeRoot`; `createChatWorktree` exists and is unused by this path |
| Progress is a guess, not a fact | `issueActivityChip` (`src/chat/issues/workflow-seeds.ts`) derives `Investigating…` / `Planning…` from status + run-id presence, not live agent state |
| No issue notifications | `NotificationKind` (`src/notifications/types.ts`) has no `issue_*` member |
| Sorting silently breaks on custom taxonomy | `STATUS_RANK` / `PRIORITY_RANK` / `TYPE_RANK` in `issues-list-sort.ts` were hardcoded to seed ids; user-created ids sorted as `NaN` |
| Dead entry points | `openIssuesFromSidebar` / `openIssuesEmbeddedInCode` (`issues-page.ts`) had no live caller — `#btnAllBugs` does not exist in `index.html` |

**Intended outcome:** Issues becomes the place a solo developer files, triages, and dispatches work without leaving the build loop, and the place an agent reports back to. Capture happens from wherever you noticed the problem. Dispatch is one keystroke. The agent works in isolation and comes back with a PR.

## 2. Feature summary

Rebuild the Issues app to Linear's standard of density, keyboard control, and inline editing; make every surface in Minnow able to file or attach to an issue; give issues a real rich-text editor that understands code, links, and checklists; and make "assign this to an agent" a complete round trip that ends in a pull request and a notification.

For: the solo builder with a repo open — the primary audience in `PRODUCT.md`.

## 3. Primary user action

**File the thing you just found, then hand it to an agent and stop thinking about it.**

Everything else is in service of those two moments. The list, the board, the filters, and the editor exist so those two moments have somewhere to land.

## 4. Confirmed decisions

Locked in the discovery interview. Do not relitigate these during build.

| Decision | Choice |
|---|---|
| **Agent runtime** | Issue = 1-task board. Assigning spins up a single-task board group behind the scenes (worktree, branch, Builder/Tester, PR). Orchestrator stays the engine; Issues renders the state. **No second agent runtime.** |
| **Agent handoff** | Always: PR and stop. Agent commits in its worktree, runs tests, opens a PR via `gh`, moves the issue to Review, alerts. The user always does the merge. One code path, no autonomy dial. |
| **Alerts** | In-app bell + Issues rail dock badge, **plus a native OS notification when the Minnow window is unfocused.** Respects existing notification prefs. |
| **Assignee model** | Two fields. `assignee` = the accountable human (you today, a real teammate later — this field exists to make future multiplayer collaboration possible). `agent` = a separate slot holding the running work agent and its live state. An agent can run on an issue you own without stealing it. |
| **GitHub** | Settings-gated mode: **Off** / **Link + push** / **Two-way mirror**. In Link + push mode, individual issues can be opted into sync with a per-issue flag. |
| **Editor** | WYSIWYG rich text, with markdown as the canonical on-disk format (see §7). |
| **In scope** | Sub-issues with hierarchy and rollups. Projects / milestones. Image and file attachments. |
| **Out of scope** | Cycles / sprints. Estimates and due dates. Multiplayer presence and real-time sync (the schema leaves room; the UI does not build it). |

## 5. Design direction

**Register:** product. Design serves the work; it does not perform.

**Color strategy: Restrained.** Tinted neutrals carry the surface; the family accent appears on the selected row, focus rings, the primary action, and the agent-running indicator only. Semantic success/warning/danger stay confined to agent run state and CI results per the Metric Color Rule in `DESIGN.md`. Status and priority chips keep the existing per-taxonomy `--issues-chip-color` hook rather than gaining a new palette.

**Theme — the scene sentence:** *A solo developer at their desk, mid-session, Code open on the main monitor, flicking to Issues for twenty seconds to file what they just hit and get back to the diff.*

That sentence does not force dark vs light, and it should not: Minnow ships 16 palette themes and the user has already chosen. What it does force is **density and dwell time**. This surface is visited in bursts of seconds, dozens of times a day, by someone whose attention is somewhere else. Every design decision resolves toward *fewer pixels traversed and fewer clicks*, not toward comfort or spaciousness. The rebuild must be verified against all 16 themes, and against `test/theme-contrast.test.mts`.

**Anchor references:**

1. **Linear's issue list** — row density, chip vocabulary, the peek slide-over, single-key property editing, grouped-and-collapsible lists.
2. **Things 3 Quick Entry with Autofill** — the menubar capture popover that grabs context from whatever you were just looking at. This is exactly the global quick-issue button, and Things solved it a decade ago.
3. **The `gh` CLI** — for the tone of git/GitHub linkage. Terse, factual, states-not-decorations. A PR chip reads `#412 · open · 2 checks passing`, not a card.

**Anti-goals:**

- **Do not become a second Orchestrator UI.** The board's internals — waves, quarantine, slots, integration branches — must not surface in Issues. Issues shows: assigned to *X*, running, asked a question, opened PR #N, failed.
- **No modal-first flows.** The existing `#issuesNewForm` inline panel and the peek slide-over are the pattern. `appConfirm` is for destructive actions only.
- **No card grids, no hero metrics.** A project rollup is a progress count in a row, not a dashboard tile.
- **Do not let the WYSIWYG editor become a second source of truth.** Markdown on disk, always.

**The AI-slop check for this surface:** the first-order reflex for "developer issue tracker" is dark chrome + purple accents + rounded cards with colored left stripes. All three are already banned by `DESIGN.md`. The second-order reflex — "Linear clone, so gray-on-gray with a subtle accent" — is closer to correct here *because it is also what Minnow's flat-chrome token system already produces*, but the tell would be copying Linear's spacing and type scale rather than deriving density from the scene sentence. Density here should be **tighter than Linear's**, because Minnow's user is glancing, not planning a sprint.

## 6. Scope

- **Fidelity:** production-ready. This replaces a shipped surface.
- **Breadth:** the whole Issues app, plus cross-cutting shell infrastructure (menu registry, command palette, shell drag layer, menubar capture, OS notifications).
- **Interactivity:** shipped-quality throughout. Keyboard parity with pointer for every action.
- **Time intent:** polish until it ships, delivered in phases with a working slice at each boundary.

## 7. Layout and surface strategy

### The list is the product

The list, not the board, is the primary surface. Board is a view of it.

- **Row** is one line, always. Density target: tighter than Linear. Grid stays token-driven like today's `--issues-list-cols` (`src/styles/issues.css`), extended for assignee, agent state, sub-issue rollup, and attachment/link counts.
- **Every property is editable inline** from the row — status, priority, assignee, labels, project — via the shared menu primitive anchored to the cell. Opening detail is for description and history, never for changing a field.
- **Grouping** replaces today's flat list: by status (default), priority, assignee, label, or project. Groups are collapsible with a count and a sticky header.
- **Ordering** within a group is manual and persistent (a `rank` field), not just sorted. Drag or `Alt+↑/↓`.
- **Sub-issues** nest one level under their parent with a disclosure triangle and a `3/7` rollup on the parent. Parent rollup also appears on board cards.
- **Saved views** are named tabs across the top of the list, replacing the current row of raw `<select>` filters. Active filters render as removable chips beneath. "Triage", "Assigned to agents", "My open" ship as defaults.
- **Triage** is a first-class lane fed by auto-filed crash reports (`src/boot/diagnostics.ts`), agent-filed issues, and imported GitHub issues. Accept promotes to Backlog; decline cancels. Unreviewed Triage count drives the rail dock badge.

### Board is the same data, arranged

Columns from taxonomy statuses as today, plus: intra-column manual ordering with a real drop indicator (today's `bindColumnDrop` in `issues-page.ts` only changes status — no index, no indicator), richer cards showing assignee/agent/labels/rollup, multi-card drag, and keyboard move.

### Peek, not page

Detail stays a slide-over over the list, as today's `.has-detail` two-column grid. Widen it, and convert the app's responsive rules from viewport `@media` to **container queries** — the house pattern this app never adopted (see `hub.css`, `research-page.css`). App surfaces run inside MinnowOS windows, so `@media` never matches the app's actual width.

### The editor

WYSIWYG rich text. The round-trip risk is real and the mitigation is architectural, not optional:

- **Markdown is canonical.** `IssueCard.description` stays a markdown string on disk. The WYSIWYG is a view over a **constrained subset** — headings, bold/italic/strike/code, lists, checklists, fenced code, blockquote, table, link, mention chips, image.
- Anything an agent writes via `issue_update` that falls outside the subset renders as a read-only raw-markdown block rather than being silently mangled. The editor never rewrites content it did not author.
- Fenced code blocks get real syntax highlighting through the existing CodeMirror setup, embedded as a node view.
- **Slash commands** (`/`) insert blocks plus Minnow-native inserts: code reference, commit link, sub-issue.
- **`#` and `@` mentions** are live chips backed by data, not text: `#KEY-12` writes a real `issueRefs` entry; `@src/foo.ts:12-34` writes a `codeRefs` entry; `@` also resolves agents and commits. Clicking a chip opens the target.
- **Checklists are state.** `- [ ]` items are clickable, persist on toggle, and roll up as a progress count on the row and card. Agents tick them off as they work.
- **Paste intelligence:** GitHub URL → live chip; `path:12-34` → code ref with snippet (half-exists at `src/state/issue-code-ref-parse.ts`); image → stored attachment; stack trace → offers to extract file refs.

### Capture: two entry points, one component

1. **Global menubar button** in the right cluster of `src/os/menubar.ts`, beside the bell. Opens a context-aware popover that pre-attaches ambient links: active file + selection, current chat, current branch and HEAD commit, workspace. Global keyboard shortcut. **The button is also a drop target.**
2. **Shell drag layer.** Dragging any linkable payload anywhere in the shell lights up both the Issues rail icon and the menubar capture button. Drop on either → the same popover, pre-filled: *New issue from this*, or attach to a recent/open issue. When Issues is already open, rows, cards, and the detail panel are direct drop targets too.

Note the known DnD gotcha documented in `src/ui/file-tree-dnd.ts`: `dragover` cannot read `DataTransfer.getData` in most browsers, so drop-target highlighting must key off a module-level active-drag descriptor, not the transfer payload.

### Right-click everywhere

"Create issue" and "Add to issue ▸" on every surface. Target surfaces: file tree, file viewer/editor selection, git graph and SCC commit rows, SCC pull requests and checks, chat messages *(has no context menu today)*, terminal selection *(none today)*, browser preview, orchestrate board cards, research library rows, and Issues' own rows.

## 8. Key states

| State | What the user needs to see and feel |
|---|---|
| **Empty (no issues)** | Not a marketing empty state. One line explaining where issues come from (you, agents, crashes, GitHub) and the two ways to file one, with the shortcut printed. |
| **Triage has items** | Rail badge + a Triage view tab with a count. Accepting is one keystroke; the queue drains visibly. |
| **Large list (500+)** | Grouping and virtualization keep it fast. `issue_get_state` currently returns everything — needs field selection and paging so agents don't blow their context. |
| **Agent assigned, not started** | Agent chip in a queued state. Clear that nothing is running yet and what will happen when it does. |
| **Agent running** | Live state on the row and card — not a guess derived from status. Current step, elapsed time, links to the worktree branch and the agent chat. |
| **Agent asked a question** | The strongest state in the app. Bell + dock badge + OS notification if unfocused. The row shows a distinct "needs you" treatment; answering is reachable from the row without hunting for the chat. Resume is immediate. |
| **Agent finished → PR open** | Issue moved to Review, PR chip live with check status, diff reachable in one click. Notification fired. |
| **Agent failed / env-blocked** | The failure reason in plain words, the failing step, and one-click retry. Distinguish "your code is broken" from "the agent's environment is broken". |
| **GitHub off / `gh` missing** | GitHub affordances absent, not disabled-and-confusing. `detectGhAvailable()` already gates the PR button this way. |
| **GitHub sync conflict (mirror mode)** | Both versions shown, explicit resolution. Never silently overwrite. |
| **Migration** | Additive and guarded, with a backup written before first write. Closed in Phase 0 — see §15. |

## 9. Interaction model

**Keyboard-first is the point, not a bonus.**

- **Global palette** (`Ctrl/Cmd+K`) — built in Phase 0, see §15.
- **Single-key actions** on the selected issue: status, priority, assignee, labels, project, agent-assign. `j`/`k` navigation. `Enter` peeks, `Escape` closes.
- **Multi-select** — extend today's Ctrl/Shift-click model to bulk status, priority, label, assign, and delete.
- **The dispatch loop:** select issue → assign agent (one keystroke) → issue enters an agent-running state → agent works in a worktree → agent either asks a question (you get pinged, you answer from the row, it resumes) or opens a PR and stops (you get pinged, you review and merge). You never had to open the Orchestrator.

Existing HITL machinery to reuse rather than rebuild: `ask_question` already blocks the tool call on a promise (`src/tools/ask-question-queue.ts`) and already alerts unconditionally (`src/notifications/ask-question.ts`) precisely so you notice. What's missing is surfacing that pending question **on the issue**, not only in the chat.

## 10. Agent tools

Current: `issue_add`, `issue_update`, `issue_get_state`, `issue_link`, `issue_delete` (`src/tools/definitions.ts`, `src/tools/issue-tools.ts`).

| Change | Why |
|---|---|
| `issue_search` | `issue_get_state` filters by status only and returns full records. Agents need query + field selection + paging. |
| `issue_comment` | There is no comment model at all — only a single overwritable `notes` string. Agents need to append to a timeline, not clobber a field. |
| `issue_assign` | Set owner/agent and start a run. Currently expressible only through the UI. |
| `issue_unlink` | `issue_link` is append-only by design; agents cannot correct a wrong link. |
| `parent_id` on `issue_add` | Sub-issues are in scope; the tool must be able to create them. |
| `issue_move` | Status + rank in one call, so agents don't fight manual ordering. |
| Attachment read access | Agents should be able to see a pasted screenshot's path, not just know one exists. |

Also worth revisiting: the `issue-writer` sub-agent (`src/agents/defaults/sub-agents.json`) is read-only plus `issue_update`/`issue_link`. A triage-shaped sub-agent that can dedupe, label, and route the Triage queue is a natural addition once Triage exists.

## 11. Phasing

Each phase ends shippable.

| Phase | Contents | Ends when |
|---|---|---|
| **0 — Foundations** ✅ | Schema v3 + guarded migration + backup. Shared context-menu primitive with real submenus. Global command + menu registry. Global `Ctrl+K` palette. Fix the `NaN` taxonomy sort bug. Resolve the dead embed entry points. | **Done — see §15.** |
| **1 — The list** ✅ | Grouping, ranking, inline property editing, keyboard model, multi-select bulk ops, saved views + filter chips, Triage lane, sub-issue hierarchy + rollups, projects, board reorder with drop indicators, container queries, peek widening. | **Done — see §16.** |
| **2 — Capture and linking** ✅ | Menubar quick-issue popover (context-aware, drop target). Shell drag layer + rail icon target. "Create issue" / "Add to issue ▸" registered on target surfaces. Attachments. | **Done — see §17.** |
| **3 — Editor** | WYSIWYG over constrained markdown, toolbar, slash commands, `#`/`@` mentions writing real refs, stateful checklists, paste intelligence, CodeMirror code blocks. | Round-trip is lossless against agent-authored markdown; test with adversarial input. |
| **4 — Agent workflow** | `agent` slot; assign → single-task board group; worktree; Builder/Tester; PR and stop. `issue_*` notification kinds; OS notification when unfocused; rail dock badge. Pending `ask_question` surfaced on the issue. Improved agent tools (§10). | Assign → walk away → get pinged → review a PR. Complete round trip, no Orchestrator visit. |
| **5 — GitHub** | `gh issue` ops in `forge-ops.js`. Settings mode Off / Link+push / Two-way mirror. Per-issue sync flag. Import, push, and mirror with explicit conflict resolution. | A GitHub issue chip is live, and mirror mode never silently loses an edit. |

## 12. Critical files

**Data and state** — `src/types.ts` (`IssueCard`, `IssuesState`), `src/state/issues-store.ts`, `src/issues/taxonomy.ts`, `server/config/store.js`, `server/config/validators.js`, `server/config/middleware.js`.

**Issues UI** — `src/ui/issues-page.ts`, `src/ui/issues-detail.ts`, `src/ui/issues-list-sort.ts`, `src/ui/issues-context-menu.ts`, `src/styles/issues.css`, and the static skeleton at `index.html:2133-2273` (Phase 1 likely moves this to rendered DOM).

**Shell** — `src/os/menubar.ts` (capture button insertion point), `src/os/app-rail.ts` (drop target), `src/ui/file-tree-dnd.ts` (DnD reference implementation and its documented gotcha).

**Agent runtime** — `src/state/orchestrate-board-actions.ts` (`startTask`), `src/state/worktree-service.ts` (`createChatWorktree`, unused by issues today), `src/chat/issues/pipeline.ts`, `src/chat/issues/board-review.ts`, `src/tools/board-tools.ts` (`board_report`).

**Notifications** — `src/notifications/types.ts` (`NotificationKind`), `src/notifications/producers.ts`, `src/notifications/ask-question.ts`, `electron/tray.ts` (the only existing native `Notification`).

**GitHub** — `server/git/forge-ops.js` (the single `gh()` choke point), `src/state/forge-api.ts` (`postForge`), `src/chat/issues/git-actions.ts`, `src/lib/git-remote-url.ts`.

**Reuse, don't rebuild** — `appConfirm`/`appPrompt` (`src/ui/app-dialog.ts`), `showToast` (`src/ui/toast.ts`), `createCodeRefLinkButton` (`src/ui/code-ref-link.ts`), `quickCaptureIssue` (`src/state/issues-store.ts`), the markdown renderer, `isTypingTarget()` (`src/ui/a11y/typing-target.ts`) for shortcut suppression. **Plus everything Phase 0 added — see §15.**

## 13. Verification

Per phase, plus these epic-wide gates:

- **Migration safety** — closed in Phase 0. Do not reopen the schema without re-reading §15.
- **Themes:** every new surface rendered in all 16 palette families; `test/theme-contrast.test.mts` green.
- **Container queries:** resize the Issues *window* (not the viewport) and confirm layout responds — the `@media`-only rules today do not.
- **Keyboard:** every action reachable without a pointer; focus visible; `role=menu` semantics on the shared primitive verified with a screen reader.
- **Editor round-trip (Phase 3, blocking):** write descriptions via `issue_update` containing markdown outside the supported subset; open, edit an unrelated part, save; assert byte-identical preservation of the untouched regions.
- **Agent loop end-to-end (Phase 4):** file an issue → assign an agent → confirm worktree created, branch named, tests run, PR opened via `gh`, issue in Review, notification fired in-app and at OS level when unfocused. Then force an `ask_question` mid-run and confirm it surfaces on the issue and resumes on answer.
- **Run the app:** use the "Minnow Full-Stack" launch config, not `npm run dev` alone (Vite-only shows the companion pairing screen and never boots MinnowOS). Verify via `javascript_tool` inspection rather than screenshots in the Browser pane.
- **Tests:** `test/os/issues-app.test.mts`, `test/state/issues-store.test.mts`, `test/ui/issues-list-sort.test.mts`, `test/tools/issue-tools.test.mts`, `test/chat/issues-*.test.mts`, `test/issues/*.test.mts`.

## 14. Open questions

1. **Board coupling boundary.** A single-task board group per issue is the runtime, but the board store keeps a 100-entry log cap and assumes a planner chat. Does each issue get its own group, or do all agent-assigned issues share one long-lived "Issues" group? Shared is cheaper; per-issue is cleaner to cancel and clean up. **Still open — Phase 4.**
2. **Projects vs. Orchestrator boards.** **Closed in Phase 1 — see §15.9 / §16.** They stay deliberately separate: `IssueProject` groups, filters, and rollups inside Issues only. No Orchestrator board coupling.
3. **`state.json` at scale.** **Closed in Phase 0 — see §15.**
4. **Palette ownership.** **Closed in Phase 0 — see §15.**
5. **OS notification permission and packaging.** Native notifications on Windows need an `appUserModelId`; confirm this doesn't disturb the frozen `build.appId`. **Still open — Phase 4.** Note `build.appId` is frozen and must not change.

---

## 15. Phase 0 — as built

Landed on `claude/issues-app-v2-design-dd7dac`. `tsc` clean, `vite build` clean, all touched suites green.

### 15.1 The migration was more dangerous than the brief knew

The brief called migration the single highest-risk item. It was worse than described, in a way that changes the design.

**Both** parsers reset state to `[]` on an unrecognized `version`: `parseIssuesState` in `src/state/issues-store.ts` *and* `validateIssuesState` in `server/config/validators.js`. The server copy sits on the `PUT /api/config/issues` path, so a client one release ahead of the server would have had its issues erased on the first save. Writing `version: 3` would have been the MIN-354 v1 wipe again.

Three fixes, all of which must survive future schema work:

1. **Version tolerance.** Only a blob with no `issues` array resets to empty. An unrecognized revision is read on its own terms and written back at its own number.
2. **Forward-compatible fields.** Both parsers copy through top-level and per-card keys the current revision does not model (`preserveUnknownKeys`). Without this, an older client silently strips a newer client's fields one save at a time.
3. **A compatibility floor.** `version` on disk is **frozen at `2`** (`ISSUES_COMPAT_VERSION`) and the real revision travels in a new `schemaRevision` field (`ISSUES_SCHEMA_VERSION`, currently `3`). Already-shipped readers reject an unknown `version`; they ignore an unknown `schemaRevision`. This is what makes the brief's gate — "a v2 client reading a v3 file degrades rather than wipes" — actually pass. Writing `version: 3` fails that gate; this passes it.

> **Do not raise `version` above 2.** Bump `ISSUES_SCHEMA_VERSION` instead. `issuesSchemaRevisionOf()` (exported from both `src/types.ts` and `server/config/validators.js`) is the single reader.

**Backup before a revision change.** `writeResource('issues')` copies the existing file to `~/.minnow/issues/backups/state.v<n>.<epoch>.json` before any write that changes the revision, keeping the newest 5. Best-effort: a failed backup never blocks a save. Path built server-side via `issuesBackupPath()` in `server/config/paths.js`, deliberately outside the `ALLOWED_CONFIG_FILES` allowlist (that allowlist gates client-addressable resources).

**Verified against a real `~/.minnow/issues/state.json`:** 4 issues migrated, all ids/links/workspaces preserved, only the deliberately-edited field differed, backup byte-identical to the pre-migration file, and the *shipped* v2 parser still reads all 4 issues out of the migrated file.

Regression tests: `test/issues/schema-forward-compat.test.mts`.

### 15.2 Schema v3 fields (additive, mostly unwritten)

`src/types.ts` gained `IssueAssignee`, `IssueAgentRun` (+ `IssueAgentPhase`), `IssueComment`, `IssueActivityEntry`, `IssueAttachment`, `IssueProject`, `IssueSavedView`, `IssueSource`; `IssueCard` gained `assignee`, `agent`, `parentId`, `rank`, `projectId`, `comments`, `activity`, `attachments`, `source`, `triagedAt`, `githubSync`; `IssuesState` gained `schemaRevision`, `projects`, `views`.

**Nothing writes these yet.** Phases 1–4 fill them in. They exist now so the migration happens once.

**Open question 3 (`state.json` at scale) is closed:** activity stays in the single debounced file, capped per issue at `ISSUE_ACTIVITY_CAP = 50` (oldest dropped first). A second append-only file with its own write path is the shape that broke MIN-354 v1, and nothing writes activity until Phase 4. **Revisit at Phase 4** when agents start writing timelines — if the blob crosses a few MB, split then.

### 15.3 Shared context menu

New: `src/ui/context-menu.ts` + `src/styles/context-menu.css`. Generalized from `issues-context-menu.ts`, which stays as a thin Issues-shaped adapter (existing call sites and tests unchanged).

- `MenuItem` = action | submenu | separator | heading.
- **Real nested submenus.** Issues previously faked them by reopening the root menu at an x/y offset, leaving no parent relationship for the keyboard or a screen reader. Now: `aria-haspopup`/`aria-expanded`, ArrowRight opens, ArrowLeft returns to the parent row, Escape closes one level at a time, hover opens after 110ms, flips left at the viewport edge.
- Also new: `role=group` headings, `menuitemcheckbox` rows, typeahead, swatches, shortcut hints, separator tidying.
- Submenu `items` accepts a function so children resolve at open time, not build time.
- Rows are 26px (44px under `pointer: coarse`).

`src/ui/menu-registry.ts` lets surfaces contribute rows by target `kind` with ordering bands (`MENU_ORDER.primary/integration/utility/destructive`). A throwing contributor is swallowed so one bad surface never costs the user the menu. **Phase 2 uses this** to register "Create issue" / "Add to issue ▸" once instead of editing 13 files.

### 15.4 Global command palette

New: `src/ui/command-palette.ts` + `src/ui/command-registry.ts` + `src/styles/command-palette.css` + `src/ui/shell-commands.ts`. Bound in `src/main.ts` via `initShellCommands()` + `initCommandPalette()`.

**Open question 4 (palette ownership) is closed: absorbed, not coexisting.** `src/ui/scc-palette.ts` is **deleted**. Source Control registers its verbs as a command source while it is open (`registerCommandSource('source-control', …)`, unregistered on close) and its header button calls `openCommandPalette()`. One chord, one palette: 37 commands across 12 groups with Source Control open, 8 without.

- Chords: `Ctrl/Cmd+K` and `Ctrl/Cmd+Shift+P`, toggling.
- **Non-capture listener that respects `defaultPrevented`.** This is deliberate: Quick Edit binds `Mod-K` inside CodeMirror and calls `preventDefault` when it runs, so with an editor selection Quick Edit still wins and the palette only takes the key when nothing closer to the caret wanted it. Do not make this a capture listener.
- `available()` gating, fuzzy subsequence matching, group headers, `aria-activedescendant`, screen-reader-only result count.
- `createCommandPalette` stays parameterised (host, class prefix) for a future scoped list; nothing ships one.

**Phase 1 should register an Issues command source** the same way Source Control does.

### 15.5 Sort and dead entry points

- `issues-list-sort.ts` ranks now derive from taxonomy order via `buildIssuesSortRanks(taxonomy)`. User-created ids no longer compare as `NaN`; ids the catalog dropped sort last. `sortIssuesForList(issues, sort, taxonomy?)` falls back to the seed catalog when no taxonomy is passed, so old call sites keep their behaviour. `issues-page.ts` passes the live taxonomy.
- `syncIssuesSidebarButton()` and its `#btnAllBugs` lookup are removed (the element never existed).
- `openIssuesFromSidebar()` turned out to be the **only** route to the Code embed, and it had no caller — so the embed was unreachable outside tests. It now has one: `APP_LAUNCH_OVERRIDES` in `shell-commands.ts` routes the palette's "Go to Issues" through it, so with Code in the foreground Issues embeds in the main column instead of taking over.

### 15.6 Two bugs found in passing

- **`instanceof HTMLButtonElement` / `HTMLElement` throws** wherever the DOM globals are not on `globalThis`. Realm-bound constructors; use identity against a known element list or duck-typing instead. Fixed in the new files; **the pattern still exists elsewhere in the codebase.**
- **`--mn-fg-subtle` bottoms out at 1.77:1** and `--mn-danger` at 3.93:1 as 13px text, across the light families. Use `--mn-fg-muted` (worst case 4.52:1) for anything meant to be read and `--mn-danger-ink` for destructive labels. Disabled text may stay on `--mn-fg-subtle` (WCAG 1.4.3 exempts inactive controls). Pinned by new cases in `test/theme-contrast.test.mts`. **Phase 1 will add a lot of secondary text — use the right tokens from the start.**

### 15.7 Also corrected

`shell-keyboard-help.ts` advertised `Ctrl/Cmd+P` ("Go to file") and `Ctrl/Cmd+Shift+P` ("Command palette") with nothing behind either. The palette entry is now real and moved to the Shell section; the unimplemented file switcher claim is removed rather than left as documentation of a feature that does not exist.

### 15.8 New files

```
src/ui/context-menu.ts          src/styles/context-menu.css
src/ui/menu-registry.ts         src/styles/command-palette.css
src/ui/command-palette.ts       test/ui/context-menu.test.mts
src/ui/command-registry.ts      test/ui/command-palette.test.mts
src/ui/shell-commands.ts        test/issues/schema-forward-compat.test.mts
```

Deleted: `src/ui/scc-palette.ts`.

---

## 15.9 Phase 1 — locked build decisions (this session)

Confirmed before implementation. Do not relitigate.

| Decision | Choice |
|---|---|
| **Projects vs boards (§14.2)** | Separate concepts. `IssueProject` groups, filters, and rollups inside Issues only. No Orchestrator board coupling. |
| **Agent-assign** | The `A` keystroke and row chip set `agent` to `{ phase: 'queued' }`. Do **not** spin a single-task board, worktree, or PR. Phase 4 owns the runtime. |
| **Virtualization** | Deferred. Grouping + collapse is enough. |
| **Triage lane identity** | Unreviewed = `source ∈ {crash, agent, github}` **and** `triagedAt` unset. Status is independent. |
| **New-issue default status** | Backlog-role status (not triage). User-created issues do not enter the Triage view. |
| **Schema** | Keep `ISSUES_COMPAT_VERSION = 2` and `ISSUES_SCHEMA_VERSION = 3`. Fill in already-migrated fields; do not bump either constant. |
| **Out of this session** | Phases 2–5. Menubar capture, shell drag layer, WYSIWYG editor, agent runtime, GitHub sync, rail dock badge / OS notifications. |

## 16. Phase 1 — as built

Landed on worktree `issues-v2-p1-a3f8c2e1` (detached from `claude/issues-app-v2-design-dd7dac`, Phase 0 uncommitted plus this phase). `tsc` clean. Suites green: `node test/run-all.mjs --suite issues` 92/92, `--suite a11y` 67/67 (includes `theme-contrast`), chat `issues-*.test.mts` 35/35. Live check on the worktree full stack (`MINNOW_HEADLESS=1 npm start`, `#/app/issues`): container-query peek, inline menus, triage identity, empty-state line, Alt+↓ reorder.

First verify **FAIL**d on empty-state wrap and unranked Alt+↓; one retry fixed both. Second verify **PASS**.

### 16.1 What landed

- Store writes for v3 card fields (`assignee`, `agent`, `parentId`, `rank`, `projectId`, `source`, `triagedAt`) plus project CRUD and saved-view seeding. Disk `version` stays **2**; `schemaRevision` stays **3**. Both parsers still `preserveUnknownKeys`.
- List chrome: saved-view tabs (Triage / Assigned to agents / My open / All), filter chips, one-line rows denser than Linear, inline cell menus via `openContextMenu({ anchor })`. `#issuesView` is a thin mount; chrome is rendered.
- Grouping (status default) with sticky collapsible headers. Rank wins inside a group; session column sort is the fallback when ranks are equal or missing. Drag and Alt+↑/↓ write ranks. The first move in a peer set materializes ranks for **all current visual peers** (then inserts), because `compareIssueRank` sorts ranked before unranked — a lone `rankBetween(null, null)` (`"h"`) would stay above an unranked neighbour.
- Triage empty copy is one 13px line (no `max-width: 65ch`): `Crashes, agents, and GitHub land here — Y accept, N/Backspace decline, C to file.` The Triage tab shows `Triage` with no count when the queue is empty, and `Triage N` when N are unreviewed.
- Sub-issues: one level. If the parent is also visible, the child nests under it even when statuses differ; if the parent is filtered out, the child is a top-level row.
- Keyboard map (suppressed by `isTypingTarget`): j/k, Enter/Escape, s/p/u/l/g, A (queue only), Y accept, N/Backspace decline, C new issue, Alt+↑/↓ rank, Shift+←/→ board column. Command source `issues` while the app is open. `?` help lists the real chords.
- Triage view keyed off `source ∈ {crash, agent, github}` + unset `triagedAt`. Accept → backlog-role + `triagedAt`. Decline → canceled-role + `triagedAt`. Diagnostics file `source: 'crash'` without `triagedAt`. `issue_add` files `source: 'agent'` into backlog-role status.
- Board: drop indicator, status+rank on drop, multi-card drag, assignee / agent queued chip / labels / sub-issue rollup on cards.
- Peek: `--issues-peek-cols: minmax(0, 1fr) minmax(380px, 520px)` on `.issues-shell`; `@container issues (max-width: 900px)` replaces the list. Width `@media` rules converted to container queries. `.issues-list-head` uses `--mn-fg-muted`.

### 16.2 Divergences and why

- **Triage empty is one line, not the §8 paragraph.** The glance surface cannot wrap; copy names sources (crashes, agents, GitHub) and the chords (Y / N/Backspace / C) instead of spelling Quick capture and New issue separately. C still opens new-issue; Quick capture remains the field in chrome.
- **New-issue shortcut is C, not N.** Decline is N/Backspace when the focused row is unreviewed; C opens the new-issue form so the two do not collide.
- **Assignee key is `u`.** The brief left the assignee chord unnamed; `a` is taken by agent-queue (`A`).
- **Hide-done is a session chip.** Built-in views copy their `hideDone` default into session filters on tab change; the chip then toggles that copy so it is not a no-op on Triage.
- **Backlog is not a board column** in the default taxonomy (`boardVisible: false`). New and accepted issues therefore show in the list until their status is a board-visible lane. Status is independent of the Triage view, as locked.
- Visual-direction-by-generation was skipped because this harness lacks native image generation. Implementation followed the confirmed §1–14 brief (density tighter than Linear; accent on selected/focused row, focus rings, primary action, and agent-running only).

### 16.3 Open questions closed

- **§14.2 Projects vs boards** — separate concepts (locked §15.9). Not reopened.

### 16.4 Traps for Phase 2

- Do not add `comments` / `activity` / `attachments` to `NORMALIZED_ISSUE_CARD_KEYS` until `ensureIssueCardShape` parses them, or a save will strip them.
- Never write `version: 3`. Capture/linking/attachments upload, shell drag, and the menubar button are Phase 2 — the row already shows `attachments/links` counts as zeros.
- Built-in views seed only when `views` is empty. A file that lost its builtins will not get them back on next open.
- Group drop currently ranks mixed parent+child visual rows. Sibling-only child ranking is still rough.
- `registerCommandSource('issues')` unregisters on close; a Code embed that tears down without `closeIssues` must still call `unbindIssuesCommands`.
- Container queries match descendants of `.issues-page`, never the page itself. Peek/layout vars stay on `.issues-shell`.
- **Expand with agent** still keys off taxonomy triage-role *status* (`canExpandIssueWithAgent`). Agent-filed cards now default to backlog-role status and enter the Triage *view* via `source` + unset `triagedAt`, so Expand is off until someone moves status to triage. Crashes still file with status `triage`, so Expand still shows for those.
- Project progress is a count of cards with that `projectId`, not a walk of sub-issue trees.


---

## 17. Phase 2 — as built

`tsc` clean, `vite build` clean. Suites green: `--suite issues` 133/133, `--suite a11y` 67/67.
Live check on the worktree full stack: menubar button mounted, popover opens with ambient
context, Enter files a real card with its chat link attached (`PUT /api/config/issues` 200),
destination menu lists recent issues, Escape unwinds menu-then-popover.

### 17.1 What landed

**One payload type, one popover.** `src/issues/capture-payload.ts` is the whole contract:
a surface says what it has (`CaptureItem` = code / git / chat / issue / file / text) and
never learns the issue schema. `src/ui/issue-capture-popover.ts` is the single component
behind every entry point — menubar button, right-click, drop on the rail, drop on the
button. It is a popover, not a dialog, per the brief's ban on modal-first flows.

**Shell drag layer.** `src/ui/capture-drag.ts` holds a module-level active-drag descriptor
and binds `dragstart` in the capture phase. This is the documented `file-tree-dnd.ts`
gotcha taken seriously: `dragover` cannot call `getData`, so drop targets ask
`dataTransferLooksCapturable()` (types only) and the "something is in flight" highlight
comes from the descriptor, never from the event.

It also reads drags it did not start. `capturePayloadFromDataTransfer` understands
`CODE_SELECTION_MIME` and `WORKSPACE_FILE_MIME`, so editor selections and file-tree rows
became droppable on Issues **without editing either surface**.

**Entry points.** Menubar button beside the bell (`src/os/menubar-capture.ts`), global
chord **`Alt + C`**, palette command "New issue from here", the Issues rail tile as a drop
target, and list rows / board cards as direct drop targets (drop on a row attaches straight
to it — no popover, because dropping on a row *is* the decision).

**Menu registry, used for the first time.** `initIssueCaptureMenus()` registers
"Create issue…" / "Add to issue ▸" once against `CAPTURE_MENU_KINDS`. Two new surfaces got
a context menu they never had: chat messages and terminal selections
(`src/ui/capture-surface-menus.ts`, delegated on `document` so they survive re-render).

**Attachments.** `server/issues/attachments-routes.js` + `src/state/issue-attachments-api.ts`
+ a section in the peek panel. Bytes go over `/api/issues/attachments`; only the record
goes in `state.json`. Three ways in: button, paste, drop. Images render as thumbnails, and
the absolute path is a visible **Copy path** button because that path is what an agent gets.

### 17.2 Decisions worth keeping

- **Ambient context never seeds a title.** The first cut titled issues "Current chat".
  `captureTitleSeed` now only promotes a label from `TITLE_BEARING_KINDS`
  (code/file/git/issue); a chat is context, not a subject. Caught in live verify.
- **Chat chips show no id.** A truncated UUID at 11px is noise; it lives on the `title`
  attribute.
- **Never overwrite an attachment.** A second `screenshot.png` becomes `screenshot-2.png`.
  Silent replacement would lose data with no undo.
- **Attachment paths are rebuilt server-side, always.** `sanitizeAttachmentSegment` +
  `issuesAttachmentPath` in `config/paths.js`, deliberately outside `ALLOWED_CONFIG_FILES`
  (same reasoning as the schema backups). Pinned by `test/issues/attachment-paths.test.mts`,
  which is the security-critical test in this phase.
- **`attachments` is now in `NORMALIZED_ISSUE_CARD_KEYS`** — safe only because
  `parseIssueAttachments` exists. §16.4's trap still applies to `comments` and `activity`.
- **Legacy menu adapter, not a 13-file rewrite.** The file tree, file viewer and git graph
  each render their own `{ label, action }` menu. `legacyCaptureMenuItems()` splices the
  registry's rows into those with one line per surface instead of rewriting three bespoke
  renderers in a capture phase.

### 17.3 Divergences

- **"Live link chips" is partial.** A commit chip carries its subject and a PR chip its
  title when the surface supplies one, but nothing calls `gh` to resolve a pasted GitHub
  URL — that is Phase 5's `forge-ops.js` work, and building a second resolver here would
  be thrown away.
- **Surfaces still without capture rows:** SCC pull-request/check rows, browser preview,
  orchestrate board cards, research library rows. The target kinds
  (`pull-request`, `browser-page`, `board-card`, `research-entry`) are defined and handled
  in `capturePayloadFromMenuTarget`, so each is a one-line registration when that surface
  is next touched.
- **Issues' own row menu was not converted** to `openRegisteredMenu`. An issue row already
  carries every issue action; adding "Create issue…" there is confusing, not useful.

### 17.4 Traps for Phase 3

- Menubar buttons are not programmatically focusable in this shell (the bell is not either
  — pre-existing, not a capture defect). Do not build focus-restore assertions against them.
- `issue-capture-context.ts` must keep importing neither the editor nor the session store;
  `issue-capture-wiring.ts` hands both over at boot. A static import there pulls CodeMirror
  into the menubar's first paint.
- `issuesStoreSync()` in `issue-capture.ts` returns null until something else has loaded the
  store. Menus must build synchronously, so this is a cache, not a promise — if a new
  surface can open a menu before the Issues app has ever loaded, it gets "Issues not loaded".
- Capture writes `description` as fenced text blocks. Phase 3's editor must round-trip those
  fences untouched; they are the first agent-shaped markdown the editor will meet.
