# MIN-261 — Issues app (Linear-style, replaces bug tracker)

**Status:** Phase 5 complete (aliases kept for one more release)  
**Worktree:** `C:\Users\dukky\.cursor\worktrees\min261-10de3b2c`  
**Branch:** `henri/min-261-issues`  
**Linear:** [MIN-261](https://linear.app/minnowai/issue/MIN-261/17-task-and-issue-tracking-app-linear-style-replaces-bug-tracker)

## Confirmed design brief (Impeccable shape)

- **Register:** product
- **Color:** Restrained (`--mn-*`, flat chrome)
- **Primary action:** quick capture → triage
- **Anchors:** Linear density + MinnowOS chrome + existing bug kanban drag
- **Scope:** Full v1 Phases 1–4; Phase 5 cleanup when stable
- **Process:** one subagent per phase; each runs Impeccable before UI mutations

## Todos

- [x] **Phase 1** — Store, app shell, migration, List+Board, filters, quick capture, `issue_*` + `bug_*` aliases, `#/bugs` redirect, sidebar badge
- [x] **Phase 2** — Detail panel + deep link, markdown, code links, `issue_link`, `issue-writer` + Expand with agent
- [x] **Phase 3** — Investigate / Plan / Debug / Board workflows + status hooks
- [x] **Phase 4** — Branch, commit grep, PR via `gh`, GitHub URL chips
- [x] **Phase 5** — Legacy bug UI removal (keep aliases), `documentation/context.md`, mode prompts, AGENTS.md counts
- [x] Tests for store/migration/tools/router (per ticket §11; Issues/alias suites 68/68 in Phase 5)
- [ ] Visual smoke of Issues app in Electron/dev (manual)

## Acceptance (overall)

- Bug data migrates; `#/bugs` → `#/app/issues`
- Quick note + agent expand
- Issue → Plan and Issue → Debug end-to-end
- File/line links open editor at range
- Commits/PRs/GH issues linkable and visible
- Branch or PR from issue when `gh` available

## Phase ownership notes

Do not delete legacy bug tracker until Phase 5. Leave `bugs/state.json` on disk after migration. New plans path: `documentation/plans/issues/<id>.md`.

## Phase 2 notes (2026-07-25)

- Detail: right slide-over (`#issuesDetailHost`); full-width under 900px; deep link `#/app/issues/ISS-n`
- Code links: paste `path:12-34` + editor context menu **Link to issue…**
- `issue_link` append-only; shipped `issue-writer`; Expand keeps status `triage`
- Deferred to Phase 3–4: workflow toolbar, git actions, richer file-tree picker UI (paste + editor link cover v1)

## Phase 3 notes (2026-07-25)

- Detail workflow toolbar: Investigate (`debugger`), Plan (Code Plan-mode seed + `codeRefs`), Plan in background (`bug-planner` → `documentation/plans/issues/<id>.md`), Debug chat, Send to board (`launchBoardFromPlan`; needs `planPath`)
- Pure builders in [`src/chat/issues/workflow-seeds.ts`](../../src/chat/issues/workflow-seeds.ts); board→`review` in [`board-review.ts`](../../src/chat/issues/board-review.ts) hooked from [`plan-complete-ui.ts`](../../src/chat/orchestrate/plan-complete-ui.ts)
- `LaunchOptions.codeRefs` + `applyCodeLaunchOptions` return `{ chatId }`
- Deferred: dedicated `issue-planner` sub-agent rename, richer activity run polling

## Phase 4 notes (2026-07-25)

- Detail Git section: Create branch (`issue/iss-n-<slug>` via `gitCheckout`), Create PR (hidden unless `gh --version` ok; uses `openWorkspacePr`), commit list (`git log --fixed-strings --grep="[ISS-n]"`), Link commit / paste GitHub issue|PR URL chips
- Pure helpers [`src/chat/issues/git-helpers.ts`](../../src/chat/issues/git-helpers.ts); actions [`git-actions.ts`](../../src/chat/issues/git-actions.ts); UI in [`issues-detail.ts`](../../src/ui/issues-detail.ts)
- Commit click → git side panel + commit diff; Open on GitHub reuses `commitUrl` / `pullRequestUrl` / `githubIssueWebUrl`
- Deferred: two-way GitHub Issues sync, favicon fetch for chips

## Phase 5 notes (2026-07-25)

- Deleted legacy All-bugs UI/store/pipeline/CSS/HTML: `global-bugs-page`, `bug-board`, `bug-board-store`, `bug-board-events`, `global-bugs`, `chat/bug-board/pipeline`, `bug-board.css`, `global-bugs-page.css`, `#globalBugsView`
- **Kept:** `bug_add` / `bug_update` / `bug_get_state` aliases in [`bug-board-tools.ts`](../../src/tools/bug-board-tools.ts); `getBugs` + migration in [`issues-store.ts`](../../src/state/issues-store.ts) (incl. `migrateLegacyBugBoardsFromChats`); `#/bugs` → `#/app/issues` via `resolveLegacyHash`
- Removed dead `isLegacyOverlayHash` (always-false stub)
- Docs: `documentation/context.md`, `AGENTS.md`, `debug.full.md` / `debug.lite.md`, mode registry copy
- **Follow-up (future release):** remove public `bug_*` tool names once callers have moved to `issue_*`
