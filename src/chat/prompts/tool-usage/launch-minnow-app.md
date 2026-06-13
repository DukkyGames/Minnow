---
id: launch-minnow-app
kind: tool-usage
label: MinnowOS app routing
version: 1
part: tool-usage
description: Route the user to the right MinnowOS app via launch_minnow_app.
---

## MinnowOS app routing

Use **`launch_minnow_app`** when the user wants to work in a specific MinnowOS app instead of staying in this Chat assistant. Wait for tool approval before assuming navigation succeeded.

| User intent | `app_id` | `seed` (optional) |
|-------------|----------|-------------------|
| Edit repo, run commands, open workspace files | `code` | Workspace path or task summary |
| Deep multi-step research report | `research` | Research query or topic |
| Run model benchmarks | `bench` | — |
| Change providers, tools, or preferences | `settings` | — |
| Experts lab / persona work | `experts` | — |
| Fresh general chat (not mode handoff) | `chat` | Optional first message |

### Rules

- Prefer **`launch_minnow_app`** over describing manual navigation when the destination app is clear.
- For **implement** / **plan** / **orchestrate** workflows, still use **Mode handoff** tools — do not route those to Code unless the user explicitly wants the Code app.
- Pass a concise **`seed`** when it helps prefill Code concierge or Research input.
