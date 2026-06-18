# Minnow — Product

## Register

**product** — UI serves local LLM chat and inference visibility; design should feel trustworthy and task-focused, not decorative.

## Users

Developers and hobbyists running LM Studio (or compatible local providers) on their machine. They switch models, compare runs, orchestrate multi-step work across modes, spawn sub-agents, and care about tokens/sec, TTFT, and context limits while chatting at a desk or on a laptop. Increasingly they also use Minnow as a local AI *workspace* — researching, coding, managing calendar/email, and scheduling agent jobs around their models.

## Product purpose

A local-first AI workspace ("MinnowOS") for OpenAI-compatible chat and agents:

- **Multi-session chat** with workspace-scoped history and streaming replies
- **Model picker** with load/unload, friendly labels, an **All / Local / Cloud** filter, and a **context usage** ring beside Send
- **Six operating modes** — General, Build, Plan, Orchestrate (board + plans), Reef (inline widgets), Debug (bug tracker)
- **Agent layer** — ~88 built-in tools, sub-agents, work agents, skills (`/commands`), tool permissions, and programmatic system prompts (full / lite / custom profiles)
- **Apps** — Code, Models, Compare (blind A/B), Bench, Research, Experts, Brain (wiki/knowledge), Calendar, Email, Scheduler
- **Workspace tools** — file tree + editor, terminal, LSP, MCP, memory + semantic recall, voice I/O, optional CDP browser automation
- Persistent **inference metrics** strip (compact instrumentation, not a marketing dashboard)

## Brand and tone

Calm, capable, technical without cosplay. Copy is short and direct. Stats read as instrumentation, not marketing.

## Anti-references

- Neon cyber HUD (scanlines, glowing dots, Rajdhani wordmarks)
- Generic ChatGPT clone (cream cards, purple gradients)
- Hero-metric dashboards (giant KPI cards with colored top stripes)
- Glassmorphism and gradient text

## Strategic principles

1. Chat readability comes first; metrics stay visible but compact.
2. Default **light** theme for bright rooms; optional **dark** (Settings → General → Appearance) inverts OKLCH tokens for low light without changing layout or metric semantics.
3. Restrained accent: one primary color for actions and live state; semantic colors only for metrics.
4. Familiar patterns: top bar, session sidebar, settings page (`#/settings/...`), message composer with mode selector and context ring.

## Scene (theme)

Developer at a desk with LM Studio on localhost, glancing between conversation, orchestrate board or sub-agent drawer, and throughput on a laptop or ultrawide in normal room lighting. Optional dark mode targets the same flow in a dim room: same bench layout, softer sheet, inverted ink accent, unchanged metric green / amber / red.
