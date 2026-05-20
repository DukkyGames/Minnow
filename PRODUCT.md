# Minnow — Product

## Register

**product** — UI serves local LLM chat and inference visibility; design should feel trustworthy and task-focused, not decorative.

## Users

Developers and hobbyists running LM Studio locally. They switch models, compare runs, and care about tokens/sec, TTFT, and context limits while chatting at a desk or on a laptop.

## Product purpose

Fast, lightweight browser client for LM Studio `v0` chat completions: multi-session chat, streaming replies, model picker, system prompt presets, and a persistent inference metrics strip.

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
4. Familiar patterns: top bar, session sidebar, settings drawer, message composer.

## Scene (theme)

Developer at a desk with LM Studio on localhost, glancing between conversation and throughput on a laptop or ultrawide in normal room lighting. Optional dark mode targets the same flow in a dim room: same bench layout, softer sheet, inverted ink accent, unchanged metric green / amber / red.
