# Softer V2 plan parser and git init at Start

**Status:** done  
**Date:** 2026-08-30  
**Register:** product

## Goal

Soften Orchestrator V2 `parsePlan` so missing or placeholder `Depends on` values (`none` / `nothing` / `n/a`, including punctuation) parse as no dependencies, and auto-run the existing MIN-615 git init at Start so a non-git workspace no longer fails after the plan parses.

## Todos

- [x] Widen `splitList` so none/nothing/n/a with punctuation and wrapping markup become empty `dependsOn`; keep unknown ids as errors; extend parse-plan tests
- [x] Add `ensureBoardWorkspaceGit` wrapping `initializeWorkspaceGit`; call from runner preflight (isolated worktrees) and `ensureBoardIntegration`
- [x] Journal opaque `board.git.initialized` only when init created a repo or first commit; surface via existing timeline
- [x] Cover no-git Start success, existing-repo no-op, init failure as 400, P2-G still git-free
- [x] Update `documentation/context.md` and write this plan file

## What was broken

`parsePlan` was already lenient on **omitted** or **empty** `Depends on`. Leftovers:

- `splitList` only dropped exact tokens `none | n/a | na | - | — | –`. Real plans write **`none.`**, **`nothing`**, **`(none)`**, **`None.`**. Those became fake task ids and the whole parse failed.
- V1 never put git init in the markdown parser. Kickoff called `initializeWorkspaceGit` **before** `board_init`. V2 `POST /api/boards` only parsed; `ensureBoardIntegration` then ran `git worktree add` and died with “not a git repository”.

`parsePlan` stays **pure** (no I/O). Git belongs in the engine/effector path.

## Implementation

1. **Softer `Depends on` (placeholders only)** in `server/orchestrator/core/parse-plan.js` `splitList`: strip wrapping punctuation/markup per token; treat `none`, `nothing`, `n/a`, `na`, and dash placeholders as no dependency. Unknown real ids stay hard errors. No previous-wave inference.

2. **Auto git init at Start** via `ensureBoardWorkspaceGit()` in `worktree-lifecycle.js` wrapping MIN-615 `initializeWorkspaceGit`. Called from runner `preflight()` when `isolateWorktrees` is on, and from `ensureBoardIntegration` (manual card Start). Skip when the effector has an explicit sandbox `cwd` (P2-G). Opaque journal event `board.git.initialized` only when a repo or first commit was actually created.

## Out of scope

- Still require YAML front matter, `name`, `## Wave Breakdown`, `#### Task id: title`, and Build / Test / Accept / Touches.
- Todos still 1:1 with task headings.
- Cycles and unknown **real** dependency ids still fail.
- No previous-wave inference when `Depends on` is omitted.
- No Wave 0 kanban card. No V1 yes/no dialog on the V2 Boards page.
