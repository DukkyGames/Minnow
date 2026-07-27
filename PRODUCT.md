# Minnow — Product

## Register

product

## Users

Three overlapping audiences, one growth direction:

- **Solo builders and indie devs** shipping software with local agents — plans, boards, code, and git in one workspace. **This is the primary audience.**
- **LM Studio and local-model hobbyists** who chat with and manage models on their own hardware.
- **Power users** with serious local-AI stacks: multi-model routing, sub-agents, encrypted credentials, and privacy-sensitive workflows.

**Growth direction:** workspace and orchestration — from "chat beside a model" to "one shop for serious local AI work." Primary references: a calm desktop shell (Minnow Shell), IDE-adjacent Code workspace, and multi-agent delivery (Orchestrator + Super Plan), not a standalone chat box or cloud dashboard.

**Scope discipline:** the shipped surface is deliberately narrow — Code, Chat, Research, Models, Brain, Issues, Scheduler, Settings. Anything that is not finished stays behind a release gate rather than landing half-built in the dock. Breadth is earned one app at a time; depth in the build loop comes first.

## Product purpose

**Minnow** is a free and open source, local-first AI workspace built around the models you already run (LM Studio, Ollama, llama.cpp, or any OpenAI-compatible API). Everything stays on your machine: keys, chats, files, Brain wiki, and encrypted secrets under `~/.minnow`.

**Mission:** put a complete AI workspace in the hands of everyone who builds, as free and open source software.

The reference point is **Blender**, not a SaaS product: one complete suite covering the whole loop, given away under a copyleft license, funded by the people who use it, and built to be taken apart by them. Minnow is a tool anyone can pick up and make anything with — and, because it is AGPL, a tool nobody can take away or put behind a gate later.

### Headline workflows

| Workflow | What it does |
|----------|----------------|
| **Desktop chat** | Default Minnow surface — concierge composer, session rail, notifications. Where most sessions start. |
| **Code** | Main build surface today — file tree, CodeMirror + LSP, terminal, git, chat beside code, inline AI completion and Quick Edit. |
| **Super Plan** | Guided planning pipeline (interview → spec → research → draft → review → polish → final) under Plan mode; non-destructive writes to `documentation/plans/`. |
| **Orchestrator boards** | Plan → kanban → Builder/Tester work agents → worktree isolation → merge and ship. Manual through AFK autonomy. |
| **Brain** | Local knowledge engine — markdown wiki, semantic recall, code index (`repo_map`, symbols), memory adapter, archive policy for long threads. |
| **Issues** | Linear-style capture and triage wired to `issue_*` tools and Debug mode — the agent files and tracks its own work. |
| **Models · Research** | Hardware-fit recommendations, downloads, local serve, provider routing; multi-step research with a saved library. |

### Platform capabilities

- **Four composer modes** — General, Build, Plan, Debug (Issues workflows) — plus Orchestrate from the hub and Super Plan under Plan. Each has tuned prompts and tool policy.
- **Agent layer** — 111 built-in tools (103 in a default build; app-bound tools are hidden with their app), sub-agents, work agents, skills (`/commands`), tool permissions (Full / Ask / Off), MCP and local plugins.
- **Minnow apps** — a fixed core set (Code, Chat, Research, Models, Brain, Issues, Scheduler, Settings) from the dock. No optional-app picker; unfinished apps stay release-gated off.
- **Workspace tools** — memory synthesis, voice I/O, browser CDP automation (Electron), webhooks, semantic embeddings.

**Success looks like:** users treat Minnow as the one place for local AI — plan here, build here, orchestrate delivery here, and grow knowledge in Brain — without cloud lock-in or subscription gates.

## Brand personality

**Warm, capable, matter-of-fact** — a tool built by and for people who make things, not enterprise cosplay.

- Copy is plain and unhurried. State what a thing does and stop. No hype ("autonomous AGI"), no growth-marketing cadence, no exclamation marks.
- Write like project documentation, not like a landing page: short declaratives, real nouns, second person. Assume the reader is capable and busy.
- Open source is the premise, not a badge. Say "free and open source" once, plainly, and let the license and the extension points do the arguing.
- Invite participation. The reader is a potential contributor and a potential builder-of-their-own — mention the seams they can open (skills, tools, prompts, themes, the fork) rather than only the features they can consume.
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
- Surface sprawl — a dock full of demo-grade apps, or a feature list padded with things that half work

## Design principles

1. **One shop for serious local work.** Chat, code, plans, boards, and knowledge share one shell — not a bundle of disconnected apps.
   **Corollary:** fewer surfaces, each finished. A gated-off app beats a shipped half-app.
2. **Free forever, local-first, open source.** AGPL-3.0-or-later; state on disk; encrypted secrets; LAN access opt-in. Strategic constraint, not a footnote. No feature is ever withheld to create a paid tier — funding comes from the people who use it, the way Blender's does.
3. **Open at the seams.** Anything the app can do, a user can extend or replace without permission: skills as `SKILL.md` files, tools as local plugins, prompts as editable markdown in the repo, themes as tokens, and the whole thing as a fork. A closed extension point is a bug.
4. **Agent-native.** Tools, sub-agents, skills, and boards are core product — not plugins bolted onto a chat box.
5. **Plain voice.** Documentation register, not marketing register. Approachable copy and real community presence; capable internals without intimidating chrome.
6. **Calm instrumentation.** Metrics and status read as bench gauges (TPS, TTFT, tokens), not marketing KPIs. Conversation stays readable where chat is the surface.
7. **Earned familiarity.** Consistent controls and navigation across apps; surprise reserved for moments, not every screen.

## Accessibility and inclusion

- **Target:** WCAG 2.1 AA for core text and control contrast across all 16 palette themes (`test/theme-contrast.test.mts`).
- **Motion:** Respect `prefers-reduced-motion`; disable decorative pulses, panel reveals, and spinner animations when reduced motion is requested.
- **Touch and pointer:** 44px minimum touch targets on session actions; hover-heavy styles behind `(hover: hover) and (pointer: fine)`.
- **Keyboard and focus:** Visible `:focus-visible` rings; composer and editor caret colors tuned for theme transitions.
- **Screen readers:** `aria-label` on icon-only controls; `role="status"` and `aria-live="polite"` on streaming and tool-call feedback; native `<select>` fallback for model picker.
- **Color:** Semantic success/warning/danger are never the only signal for state (tool calls pair color with text labels).
