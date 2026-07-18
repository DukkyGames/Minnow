# Minnow — Product

## Register

product

## Users

Three overlapping audiences, one growth direction:

- **Solo builders and indie devs** shipping software with local agents — plans, boards, code, and git in one workspace.
- **LM Studio and local-model hobbyists** who chat, compare models, and benchmark on their own hardware.
- **Power users** with serious local-AI stacks: multi-model routing, sub-agents, encrypted credentials, and privacy-sensitive workflows.

**Growth direction:** workspace and orchestration — from "chat beside a model" to "one shop for serious local AI work." Primary references: a calm desktop shell (MinnowOS), IDE-adjacent Code workspace, and multi-agent delivery (Orchestrator + Super Plan), not a standalone chat box or cloud dashboard.

## Product purpose

**Minnow** is a free, open-source, local-first AI workspace (**MinnowOS**) built around the models you already run (LM Studio, Ollama, llama.cpp, or any OpenAI-compatible API). Everything stays on your machine: keys, chats, files, Brain wiki, and encrypted secrets under `~/.minnow`.

### Headline workflows

| Workflow | What it does |
|----------|----------------|
| **Desktop chat** | Default MinnowOS surface — concierge composer, session rail, notifications. Where most sessions start. |
| **Code** | Main build surface today — file tree, CodeMirror + LSP, terminal, git, chat beside code, inline AI completion and Quick Edit. |
| **Super Plan** | Guided planning pipeline (interview → spec → research → draft → review → polish → final) under Plan mode; non-destructive writes to `documentation/plans/`. |
| **Orchestrator boards** | Plan → kanban → Builder/Tester work agents → worktree isolation → merge and ship. Manual through AFK autonomy. |
| **Brain** | Local knowledge engine — markdown wiki, semantic recall, code index (`repo_map`, symbols), memory adapter, archive policy for long threads. |
| **Models · Research · Compare** | Hardware-fit recommendations, downloads, local serve; multi-step research library; blind A/B across 2–6 models. |

### Platform capabilities

- **Six operating modes** — General, Build, Plan, Orchestrate, Reef (inline widgets), Debug (bug tracker) — each with tuned prompts and tool policy.
- **Agent layer** — ~88 built-in tools, sub-agents, work agents, skills (`/commands`), tool permissions (Full / Ask / Off), MCP and local plugins.
- **MinnowOS apps** — Calendar, Email, Scheduler, Experts, Bench, Evals, and more from the dock.
- **Workspace tools** — memory synthesis, voice I/O, browser CDP automation (Electron), webhooks, semantic embeddings.

**Success looks like:** users treat Minnow as the one place for local AI — plan here, build here, orchestrate delivery here, and grow knowledge in Brain — without cloud lock-in or subscription gates.

## Brand personality

**Warm, capable, solo-friendly** — a tool built by and for people who ship alone, not enterprise cosplay.

- Copy is direct and human, not hype-y ("autonomous AGI") or corporate.
- Community is part of the product story (open source, Discord, sponsors) without being needy.
- Technical credibility through capability (tools, boards, LSP), not neon chrome or dashboard theater.
- Privacy and local control are assumed defaults, stated plainly when relevant — not fear-marketed.

## Anti-references

**Visual**

- Neon cyber HUD (scanlines, glowing dots, Rajdhani wordmarks)
- Generic ChatGPT clone (cream cards, purple gradients)
- Hero-metric dashboards (giant KPI cards with colored top stripes)
- Glassmorphism and gradient text
- Decorative motion that does not convey state

**Positioning and voice**

- Cloud-only AI tools and subscription gatekeeping as the default mental model
- Hype-y autonomous-agent marketing language
- Enterprise bloatware patterns (empty dashboards, vanity metrics, modal-first flows)

## Design principles

1. **One shop for serious local work.** Chat, code, plans, boards, and knowledge share one shell — not a bundle of disconnected apps.
2. **Free forever, local-first, open source.** AGPL-3.0-or-later; state on disk; encrypted secrets; LAN access opt-in. Strategic constraint, not a footnote.
3. **Agent-native.** Tools, sub-agents, skills, and boards are core product — not plugins bolted onto a chat box.
4. **Friendly solo-dev tone.** Approachable copy and community presence; capable internals without intimidating chrome.
5. **Calm instrumentation.** Metrics and status read as bench gauges (TPS, TTFT, tokens), not marketing KPIs. Conversation stays readable where chat is the surface.
6. **Earned familiarity.** Consistent controls and navigation across apps; surprise reserved for moments, not every screen.

## Accessibility and inclusion

- **Target:** WCAG 2.1 AA for core text and control contrast across all 16 palette themes (`test/theme-contrast.test.mts`).
- **Motion:** Respect `prefers-reduced-motion`; disable decorative pulses, panel reveals, and spinner animations when reduced motion is requested.
- **Touch and pointer:** 44px minimum touch targets on session actions; hover-heavy styles behind `(hover: hover) and (pointer: fine)`.
- **Keyboard and focus:** Visible `:focus-visible` rings; composer and editor caret colors tuned for theme transitions.
- **Screen readers:** `aria-label` on icon-only controls; `role="status"` and `aria-live="polite"` on streaming and tool-call feedback; native `<select>` fallback for model picker.
- **Color:** Semantic success/warning/danger are never the only signal for state (tool calls pair color with text labels).
