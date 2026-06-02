# Orchestrate plan authoring screen — implementation notes

## Summary

Full-width **plan authoring** overlay in `#chatArea` for drafting Orchestrate plans before board init. Entered from **Orchestrate hub** → **Make a plan** (`orchestrate-hub__make-plan-btn`). Mutual exclusion with Vibe hub, Orchestrate hub, and board view.

## Modules

| File | Role |
|------|------|
| [`src/ui/orchestrate-plan-screen.ts`](../../src/ui/orchestrate-plan-screen.ts) | Mount/teardown, suspend on sidebar switch, resume banner |
| [`src/styles/orchestrate-plan-screen.css`](../../src/styles/orchestrate-plan-screen.css) | Layout + suspended banner |
| [`src/chat/streaming-state.ts`](../../src/chat/streaming-state.ts) | `isStreamDomVisible` → false while plan screen suppresses chat DOM |
| [`src/ui/messages.ts`](../../src/ui/messages.ts) | Stream/bubble stubs; `renderChatFromHistory` teardown + suspended banner |

## Behavior

1. **Make a plan** — `teardownOrchestrateHub()` then `openOrchestratePlanScreen()` (reuses empty Orchestrate chat or creates one).
2. **DOM suppression** — `isOrchestratePlanScreenSuppressingChatDom()`; `appendBubble` / `appendStreamingAssistantRow` use the same stub path as board view.
3. **Sidebar switch** — `suspendOrchestratePlanScreenOnLeave` + `teardownOrchestratePlanScreen` in `switchChat`; returning to the plan chat shows the resume banner until **Resume** or **Show chat**.
4. **Hub / Vibe hub** — `teardownOrchestratePlanScreen()` when opening either hub (`renderHub`, `renderOrchestrateHub`, `teardownHub`).

## UI (2026-06)

- Centered layout aligned with Orchestrate hub (`orchestrate-plan-screen` flex center, max-width 640px).
- Prompt phase: eyebrow **Orchestrate**, lede explaining `documentation/plans/`, hint under textarea.
- Working phase: status block with hub-style pulse dot, technical rotating status lines, mono activity subline.
- Preview: path chip (mono), primary **Open board** on the right; flat banner (border, no accent wash).

## Manual verification

1. Open Orchestrate hub → **Make a plan** → prompt visible; composer hidden (plan screen owns input).
2. Start a stream (send from composer) → no duplicate bubbles in `#chatArea` while plan screen is open.
3. Switch to another chat → plan chat shows suspended banner when selected again.
4. **Resume plan screen** restores overlay; **Show chat** clears session and renders history.

## Tests

- `test/ui/orchestrate-hub.test.mts` — **Make a plan** button present.
- `test/ui/orchestrate-plan-screen.test.mts` — mount prompt, stream DOM stubbed.
