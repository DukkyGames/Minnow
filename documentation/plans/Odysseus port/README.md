# Odysseus to Minnow Port Plan Index

This folder contains implementation-ready plans for porting the 13 selected Odysseus capabilities into Minnow. Each plan is written for another agent to execute directly and includes:

- **What's needed** — prior plans, npm packages, binaries, credentials, effort estimate
- **Prerequisites & deliverables** — shippable outputs per phase
- **Files to create / modify** — concrete paths in the Minnow repo
- **Config & API contracts** — schemas and route tables
- **Detailed implementation phases** — ordered steps with day estimates
- **Odysseus tests to port** — source regression tests to adapt
- **Implementation TODOs**, acceptance criteria, verification, and risks

## Source Baseline

- Minnow architecture reference: `documentation/context.md`.
- Odysseus reference source: `documentation/reference/odysseus-dev/odysseus-dev`.
- Existing Minnow persistence root: `~/.minnow`.
- Server middleware registration: `server/runtime/middlewares.js`.
- MinnowOS app registration: `src/os/types.ts`, `src/os/app-registry.ts`, `src/os/app-host.ts`, `src/os/icons.ts` when a new icon is needed, and `index.html`.
- Settings registration: `src/ui/settings-page-types.ts`, `src/ui/settings-sections.ts`, and `index.html`.

## Dependency Order

1. `odysseus-port-13-prompt-injection-defense.md` — **no deps**; ship first
2. `odysseus-port-12-encrypted-secrets.md` — **no deps**; ship before any credential storage
3. `odysseus-port-01-semantic-memory.md` — needs #13
4. `odysseus-port-03-ab-compare.md` — no deps
5. `odysseus-port-04-fallback-chains.md` — no deps; benefits #8 utility calls
6. `odysseus-port-08-memory-skill-synthesis.md` — needs #1 + #13; benefits from #4
7. `odysseus-port-02-cookbook-hardware.md` — needs #12 for M3+ HF tokens
8. `odysseus-port-05-scheduler-reminders.md` — needs #12; pairs with #10 reminders
9. `odysseus-port-06-webhooks.md` — needs #12; hooks #5 scheduler events
10. `odysseus-port-07-voice-io.md` — needs #12 for provider path
11. `odysseus-port-09-email.md` — needs #12 + #13
12. `odysseus-port-10-calendar.md` — needs #12; pairs with #5
13. `odysseus-port-11-image-gen-gallery.md` — needs #12; optional #2 for local diffusion

## Plans

| # | Plan | Tier | Effort | Est. days | Primary dependency |
|---|------|------|--------|-----------|------------------|
| 1 | `odysseus-port-01-semantic-memory.md` | 1 | M-L | 5–8 | #13 |
| 2 | `odysseus-port-02-cookbook-hardware.md` | 1 | XL | 15–25 | #12 |
| 3 | `odysseus-port-03-ab-compare.md` | 1 | M | 4–6 | None |
| 4 | `odysseus-port-04-fallback-chains.md` | 1 | M | 3–5 | None |
| 5 | `odysseus-port-05-scheduler-reminders.md` | 2 | M-L | 5–8 | #12 |
| 6 | `odysseus-port-06-webhooks.md` | 2 | S-M | 3–4 | #12 |
| 7 | `odysseus-port-07-voice-io.md` | 2 | M-L | 5–7 | #12 |
| 8 | `odysseus-port-08-memory-skill-synthesis.md` | 2 | M | 4–6 | #1, #13 |
| 9 | `odysseus-port-09-email.md` | 3 | XL | 12–18 | #12, #13 |
| 10 | `odysseus-port-10-calendar.md` | 3 | L-XL | 10–15 | #12 |
| 11 | `odysseus-port-11-image-gen-gallery.md` | 3 | M-L | 6–9 | #12 |
| 12 | `odysseus-port-12-encrypted-secrets.md` | 4 | M | 2–3 | None |
| 13 | `odysseus-port-13-prompt-injection-defense.md` | 4 | S | 1–2 | None |

**Suggested parallel tracks after #13 + #12 land:**

- Track A (models): #03 Compare + #04 Fallback + #02 Cookbook M1–M2
- Track B (memory): #01 Semantic memory → #08 Synthesis
- Track C (integrations): #06 Webhooks + #05 Scheduler → #07 Voice
- Track D (productivity): #09 Email → #10 Calendar → #11 Gallery

## New MinnowOS Apps (closed `AppId` union)

Each app requires updating `src/os/types.ts` before registry/host wiring:

| Plan | AppId | Hash route |
|------|-------|------------|
| #02 Cookbook | `cookbook` | `#/app/cookbook` |
| #03 Compare | `compare` | `#/app/compare` |
| #09 Email | `email` | `#/app/email` |
| #10 Calendar | `calendar` | `#/app/calendar` |
| #11 Gallery | `gallery` | `#/app/gallery` |

## New Settings Sections

| Plan | `SettingsSectionId` | Nav group |
|------|---------------------|-----------|
| #06 Webhooks | `webhooks` | Tools & integrations |
| #07 Voice | `voice` | Models & APIs |
| #01 Memory embeddings | (extend `memory`) | Prompting & memory |
| #04 Fallback | (extend `model-routing`) | Models & APIs |
| #05 Scheduler | `scheduler` or MinnowOS app | TBD |
| #08 Proposals | (extend `memory`) | Prompting & memory |

## Linear Tracking

Project: [Odysseus to Minnow Port](https://linear.app/minnowai/project/odysseus-to-minnow-port-9e0acc5cf9c9)

| Plan | Issue |
|------|-------|
| `odysseus-port-01-semantic-memory.md` | [MIN-122](https://linear.app/minnowai/issue/MIN-122/odysseus-port-01-semantic-memory-and-embeddings) |
| `odysseus-port-02-cookbook-hardware.md` | [MIN-125](https://linear.app/minnowai/issue/MIN-125/odysseus-port-02-cookbook-hardware-aware-model-management) |
| `odysseus-port-03-ab-compare.md` | [MIN-119](https://linear.app/minnowai/issue/MIN-119/odysseus-port-03-blind-ab-model-compare) |
| `odysseus-port-04-fallback-chains.md` | [MIN-128](https://linear.app/minnowai/issue/MIN-128/odysseus-port-04-model-fallback-chains) |
| `odysseus-port-05-scheduler-reminders.md` | [MIN-120](https://linear.app/minnowai/issue/MIN-120/odysseus-port-05-scheduled-tasks-and-reminders) |
| `odysseus-port-06-webhooks.md` | [MIN-118](https://linear.app/minnowai/issue/MIN-118/odysseus-port-06-outgoing-webhooks) |
| `odysseus-port-07-voice-io.md` | [MIN-123](https://linear.app/minnowai/issue/MIN-123/odysseus-port-07-voice-io) |
| `odysseus-port-08-memory-skill-synthesis.md` | [MIN-127](https://linear.app/minnowai/issue/MIN-127/odysseus-port-08-memory-synthesis-and-skill-auto-learning) |
| `odysseus-port-09-email.md` | [MIN-126](https://linear.app/minnowai/issue/MIN-126/odysseus-port-09-email-integration) |
| `odysseus-port-10-calendar.md` | [MIN-129](https://linear.app/minnowai/issue/MIN-129/odysseus-port-10-calendar-caldav-and-ics) |
| `odysseus-port-11-image-gen-gallery.md` | [MIN-121](https://linear.app/minnowai/issue/MIN-121/odysseus-port-11-image-generation-and-gallery) |
| `odysseus-port-12-encrypted-secrets.md` | [MIN-117](https://linear.app/minnowai/issue/MIN-117/odysseus-port-12-encrypted-credential-storage) |
| `odysseus-port-13-prompt-injection-defense.md` | [MIN-124](https://linear.app/minnowai/issue/MIN-124/odysseus-port-13-prompt-injection-defense) |

## Global Rules For Executors

- Update `documentation/context.md` after each shipped feature.
- Prefer native Minnow surfaces over MCP-only substitutes.
- Keep new APIs local-first and file-backed under `~/.minnow` unless a plan explicitly says otherwise.
- New MinnowOS apps must extend the closed `AppId` union in `src/os/types.ts` before adding registry entries or host layers.
- Register new server APIs through `server/runtime/middlewares.js`, not directly in `server.js`.
- Never store credentials outside `server/security/secret-box.js` after #12 lands.
- Treat web, memory, email, calendar, and file-derived text as untrusted prompt data after #13 lands.
- Add focused tests before broad full-suite runs; use `npx tsc --noEmit` when touching shared TypeScript contracts.
- Each plan's **Detailed Implementation Phases** are the execution order; complete phase verification before moving on.
- Port listed Odysseus tests where practical — they encode edge cases discovered in production.

## Persistence Layout (after all plans ship)

```
~/.minnow/
├── .key                          # #12 encryption key (0o600)
├── memory/
│   ├── entries/                  # existing
│   ├── vectors.json              # #01
│   └── proposals.json            # #08
├── skills/
│   └── proposals.json            # #08
├── compare/                      # #03
├── cookbook/
│   └── downloads.json            # #02
├── scheduler.json                # #05
├── scheduler-runs/               # #05
├── scheduler-notifications.json  # #05
├── webhooks.json                 # #06
├── email/                        # #09
├── calendar/
│   └── calendar.db               # #10
├── gallery/                      # #11
│   ├── images/
│   └── index.json
└── models/                       # #01 embeddings, #02 downloads
    └── embeddings/
```
