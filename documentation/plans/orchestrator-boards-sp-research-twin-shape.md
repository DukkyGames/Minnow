# Shape brief: Orchestrator boards as Super Plan / Research twin

**Status:** confirmed; craft landed (awaiting visual review)  
**Worktree:** `orch-boards-abb67409`  
**Date:** 2026-08-07  
**Register:** product (DESIGN.md / PRODUCT.md)

---

## 1. Feature summary

Redesign Orchestrator boards (hub list + live board detail, including onboarding and finish) into one page family that matches the Super Plan (`sp-*`) and Research (`rs-*`) shell: library rail + measured main pane, sticky runhead, segment tabs, mono section rhythm, row-not-card lists.

Solo builders use this surface to start a board from a plan, watch Builder/Tester work agents, and ship. Success: opening Orchestrate feels like the same calm workspace as Super Plan and Research, while the board body stays an operational kanban (waves × lanes × tasks), not a document reader.

## 2. Primary user action

Select or start a board from the rail, then run and monitor delivery on the kanban in the main pane (Start / Stop, exec mode, task progress) without leaving the shell.

## 3. Design direction

| Decision | Choice |
|----------|--------|
| **Color strategy** | **Restrained** (product default). Accent on primary actions, selection, and live status only. Semantic success/warning/danger for run state and metrics only (Metric Color Rule). |
| **Theme scene** | Solo builder at an evening desk, one monitor, watching agents move cards; ambient room light, not a 2am war room. Mood: calm instrumentation. Theme follows the app family (`swamp-dark` default); no board-only dark override. |
| **Named anchors** | (1) Minnow Super Plan page shell, (2) Minnow Research page shell, (3) Linear project board density for lanes/tasks without SaaS KPI chrome. |
| **Probe winner** | N/A (visual probes skipped; target twin already shipped in-repo). |

Per-surface override: none. Stay inside `--mn-*` tokens and Flat Chrome Rule. No new palette.

## 4. Scope

| Axis | Intent |
|------|--------|
| **Fidelity** | Production-ready |
| **Breadth** | Whole Orchestrate surface family: empty/start, board library rail, live board, onboarding, finish |
| **Interactivity** | Shipped-quality components (same behaviors as today) |
| **Time intent** | Polish until it ships |

Out of scope for this redesign: new autonomy models, new agent types, changing wave/lane semantics, AFK policy changes. Visual + chrome IA only, preserving existing board APIs and run controls.

## 5. Layout strategy

**One shell, two pane modes** (mirror `sp-shell` / `rs-shell`):

```
.ob-shell
├── .ob-rail          library of boards (rows), New / filter, plan-start CTA in head or foot
└── .ob-main
    ├── empty / start → .ob-pane--ask   (plan pick + start; seeds if useful)
    └── active board  → .ob-pane--run
        ├── .ob-runhead   (title, state badge, sparse actions, quiet stats)
        ├── .ob-segments  (Board | Timeline | Plan) when those views exist
        └── .ob-body      (kanban waves, or segment content)
```

**Hierarchy**

1. **Rail** carries board identity and switching (hairline rows like `.sp-row` / `.rs-row`). Kill the centered 640px “Vibe hub” marketing column as the primary list.
2. **Runhead** replaces today’s dense `.board-header` instrument strip. Keep Start/Stop, exec mode, and essential telemetry, but demote concurrency/AFK/final-test chips into a quiet meta row or overflow, matching `.sp-runhead` calm.
3. **Body** keeps multi-wave kanban as the primary working surface. Soften `.board-task-card` toward bordered lane items (still draggable/clickable tasks), not nested card stacks. Wave blocks use mono section rules (`.ob-sec` twin of `.sp-sec` / `.rs-sec`) instead of heavy card chrome.
4. **Host:** stay in the Code chat column / plan-screen host pattern (like Super Plan), edge-to-edge (`chat-area--orchestrate` or equivalent), not a separate OS app unless product later promotes it.

**Responsive:** collapse rail (Super Plan `is-rail-hidden` pattern); kanban columns already breakpoint (4→2→swipe); keep that behavior inside `.ob-body`.

## 6. Key states

| State | User should see / feel |
|-------|-------------------------|
| **Empty library** | Rail empty copy that teaches (“Start a board from a plan”); main pane ask/start, not a dead void. |
| **Ask / start** | Plan select + primary Start; optional recent/seed plans; calm, same as Research ask. |
| **Board loading** | Skeleton runhead + lane placeholders (not a centered spinner). |
| **Ready (not running)** | Quiet runhead, full kanban, Start primary. |
| **Running** | Live badge + progress in runhead; lane motion via status moves; reduced-motion respected. |
| **Paused / stalled / failed** | State chip + plain recovery copy in runhead meta; no alarmist chrome. |
| **Onboarding (pre-board)** | Pane-level flow inside `.ob-main` (questions / git), not a separate hero world. |
| **Finish** | Finish dashboard as a pane segment or body replacement inside the shell (rail still lists the completed board). |
| **Error (API / worktree)** | Inline error in pane with retry; keep rail usable. |
| **Power density** | Many boards in rail (filter); many waves/tasks: scroll body, collapsed wave summaries stay. |

## 7. Interaction model

- **Rail row click** → select board, load pane (same as SP/Research library).
- **New / Start** → ask pane or immediate create-from-plan (preserve current start flow).
- **Runhead Start/Stop** → existing board run controls.
- **Exec mode segments** → stay in runhead (or a compact control group), not a second competing segment bar; if conflict with Board/Timeline/Plan tabs, put exec mode in runhead actions and content segments below.
- **Task click** → existing task plan panel / detail (prefer right aside or overlay that fits measured pane, not a new modal-first path).
- **Wave collapse** → compact counts + chip strip (keep).
- **Hover/focus** → product standard; 44px touch on primary actions; `prefers-reduced-motion` on live dots.

## 8. Content requirements

- Rail labels: board title, state chip, quiet relative time or progress fraction.
- Ask pane: short lede (“Run a plan as a board”), plan field label, Start CTA, empty hint.
- Runhead: title, state (Ready / Running / Complete / Failed / …), Start/Stop, exec mode labels (Manual / AFK / … as today).
- Segments: Board, Timeline, Plan (only if those views already exist; do not invent empty tabs).
- Empty / error microcopy: plain documentation voice (PRODUCT.md); no hype, no exclamation marks.
- Dynamic ranges: 0 boards (empty), typical 1–15 boards, large 50+ (filter); waves 1–N; tasks per lane 0–30 typical.
- Media: none required (semantic CSS / existing icons only).

## 9. Recommended Impeccable references (for craft)

- `reference/product.md` (already applied)
- `reference/layout.md` — rail + pane rhythm, collapse
- `reference/typeset.md` — mono section labels vs body
- `reference/clarify.md` — empty/error/ask copy
- `reference/harden.md` — loading/error/reduced-motion
- `reference/polish.md` — final pass before ship
- Avoid `brand.md` / campaign patterns; this is product chrome.

## 10. Open questions (asserted defaults)

None blocking. Defaults asserted:

1. **Prefix:** `ob-*` (orchestrate board), twin of `sp-*` / `rs-*`.
2. **Kanban stays** the Board segment body; do not replace with a ledger-only or markdown document view.
3. **Host stays** Code-column / chat-area overlay family (Super Plan pattern), not a new OS app rail entry.
4. **Telemetry** demoted into quiet mono stats in runhead; no hero-metric tiles.

---

## Anti-goals

- Hero-metric / KPI dashboard chrome
- Keeping the 640px centered marketing hub as the primary list
- Glass, gradient text, side-stripe accents, nested card grids
- Replacing operational controls with “pretty but unusable” chrome
- Diverging visual language from Super Plan / Research after this ship

## Biggest risk

Quieting the header so far that Start/Stop, exec mode, or stalled state become hard to find mid-run. Mitigate: keep those controls in the sticky runhead at all times; demote only secondary chips.

---

## Implementation todos (post-confirmation craft)

- [x] Confirm this brief with the user (gate)
- [x] Introduce `.ob-shell` / rail / main structure; retire centered hub list as primary
- [x] Restyle board list as `ob-row` library; wire selection to pane
- [x] Rebuild ask/start + empty states as `ob-pane--ask`
- [x] Replace dense `.board-header` with `.ob-runhead` + quiet meta; preserve all run controls
- [x] Restyle waves / kanban / task items to match section + lane vocabulary (keep behavior)
- [x] Fold onboarding + finish into pane states inside the shell
- [x] Align CSS with `sp-*` / `rs-*` sizing vars, container queries, rail collapse
- [x] Update tests that assert hub/board DOM classnames
- [x] Update `documentation/context.md` for the new Orchestrate page family
- [ ] Visual polish pass (`impeccable polish`) against Super Plan / Research side-by-side

---

**Craft landed in worktree.** Merge-back: `/apply-worktree`. Visual review still open: what's working, what isn't?
