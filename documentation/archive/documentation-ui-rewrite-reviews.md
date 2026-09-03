# Documentation UI rewrite — reviews & inventory

Companion to [`documentation-ui-rewrite-plan-2026-08-07.md`](documentation-ui-rewrite-plan-2026-08-07.md).  
Worktree: `wiki-docs-b14e7589` @ `27b86937`.

## Phase 0 inventory (docs-a0-inventory)

- **Released apps:** 7 (Code, Research, Models, Brain, Scheduler, Issues, Settings).
- **Legacy routes:** `#/desktop` / `#/` → `#/workspaces`; `#/app/chat` → `#/app/code/chat`; hidden apps → `#/workspaces`.
- **Densest stale manual pages:** `overview.md`, `first-chat.md`, `install.md`, `how-minnow-works.md`, `modes.md` (Phase 1 addressed).

Full row-level table: see subagent transcript [docs-a0-inventory](f07f6b8b-23d7-4d52-9812-a3d31bd3aed9).

## Phase 1 author agents

| Agent | Scope | Result |
|-------|--------|--------|
| [docs-b1-readme + docs-b2-product](44e51296-84c8-4696-9fb9-fb1a0ba746eb) | README.md, PRODUCT.md | Workspace-first spine |
| [docs-a4 + a1 + a2](7f208987-acd6-404c-832f-10f7f85a0815) | overview, first-chat, how-minnow-works | Seven apps, Code chat |
| [docs-c2-agents](a934360d-08f7-463e-8927-e482d07660e5) | AGENTS.md | Seven-app list + legacy hash note |
| [docs-a1 install/modes](f9cac494-b75b-408e-aa01-795b771f6044) | install.md, modes.md | Picker → Code; Desktop = policy |

## Phase 1 reviews

### review-front-door ([6fb61538-71e4-4e32-a57f-57b0187761af](6fb61538-71e4-4e32-a57f-57b0187761af))

**Scores (before fixes):** Accuracy 3, Voice 3, AI smell 3, Legacy 4.

**Must-fix applied:** Tool count 106 default build; auto-update qualified; em dashes removed; Settings → Apps optional toggles corrected; router facts on PRODUCT Code row.

**Should-fix (open):** README feature grid still brochure-like; Orchestrate as mode not app; onboarding prompt still lists Chat; PRODUCT “Success looks like” trim.

### review-manual ([7f557e6c-e354-4c32-b37a-a6a703815fb8](7f557e6c-e354-4c32-b37a-a6a703815fb8))

**Must-fix applied:** `manual/README.md` seven apps; `overview.md` six rail + Settings in menubar.

**Should-fix (open):** `how-minnow-works.md` hype lines; `overview.md` user-disabled app toast; loose “dock” wording.

## Phase 2 (completed in worktree)

| Agent | Files |
|-------|--------|
| Authors (main thread + [context pass](433145e7-ab53-43ad-890e-efd6d6829a14)) | `apps-and-routes.md`, `architecture.md`, manual reference, `code.md`, `ROADMAP.md`, `release-e2e-testing.md`, `v0.0.1.md`, `context.md` wording |
| [review-contributor](c5b63101-0c93-4e1c-ba48-6742b7c54497) | Fixed electron:dev description, Phase 5 fullscreen story, hidden-app routing accuracy, glossary legacy hashes |

### Phase 2 open items

- [x] `manual/apps/overview.md` full-stage Models/Brain/Settings (Phase 3)
- [x] `design-system/shell.md`, `documentation/images/README.md` spec (Phase 3; PNG refresh deferred)
- [x] Onboarding/desktop prompts (seven apps, Code-primary)
- [x] README dock → app rail wording

## Phase 3 (completed in worktree)

| Area | Result |
|------|--------|
| Straggler sweep | Manual, README, PRODUCT, ROADMAP, design-system shell/css-map, release-e2e, prompts, accessibility-audit |
| Wiki QA | `npm run wiki:generate`; `product-wiki.test.mjs` + banned-phrase catalog scan |
| Images | `documentation/images/README.md` workspace-first spec; `app-chat.png` row removed |
| context.md | Wiki doc-pass note; “ninth dock app” → app rail |

### Phase 3 review notes

- **review-manual:** overview vs apps-and-routes aligned on six rail apps + Settings menubar; legacy hashes cite glossary.
- **review-front-door:** PRODUCT app rail wording; README “seven core apps on the app rail”.
- **review-secondary:** shell.md Phase 5 legacy module table; release-e2e overlay section replaces floating-window checklist.

## Voice checklist (all future edits)

- [x] No em dashes in user-facing copy (PRODUCT rule) — spot-check Phase 3 edits
- [x] Say **Minnow Shell** when meaning the Electron binary
- [x] Say **Desktop** only for Settings section or composer **Desktop** tool policy
- [x] Lead with workspace pick → Code, not feature laundry lists
