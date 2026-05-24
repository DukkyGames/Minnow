# Research mode: Perplexity-class pipeline (shipped)

This document summarizes **shipped** Research mode behavior after the pipeline update (mode prompt **v3**, work agent **v3**, new **`researcher`** sub-agent type). The original implementation checklist lives in the Cursor plan `research_mode_pipeline_a9cb49e1` (repo-local under `.cursor/plans/`; do not edit that file from automation).

## What changed

- **Lead researcher (main thread):** Research **mode** prompts describe a **four-phase** workflow: **Clarify** (`ask_question`) → **Plan** (3–6 threads) → **Fan-out** (`spawn_sub_agent` with `type: "researcher"`, `"wait": false`, then poll `list_sub_agents` / `get_sub_agent_status`) → **Synthesize** (600–1500 words, global `[n]` citations, `## References`).
- **Research worker (sub-agent):** New sub-agent type **`researcher`** in `src/agents/defaults/sub-agents.json` with label **Research worker**, read-only tool allowlist, and worker prompts under `src/agents/prompts/sub-agents/researcher.*.md` (mirrored in `SHIPPED_SUB_AGENT_PROMPTS`).
- **Work agent `researcher`:** Composed on the main Research turn for read-only guardrails only; orchestration and final report template live in the **mode** prompt (no duplicate Summary/Findings template in the work agent).

## Concurrency

`researcher.maxConcurrent` defaults to **5**, but **`globalMaxConcurrent`** (default **3**) caps **all** sub-agent types together. Users can raise the global cap or per-type limits under **Settings → Sub-agents**; the Research mode section in **Settings → Modes** includes a short hint when expanding Research.

## Verification

- Automated: `test/sub-agents/sub-agent-config.test.mts`, `test/sub-agents/sub-agent-tools.test.mts`, `test/prompts/research-mode-pipeline.test.mjs`, plus `npx tsc --noEmit` and `npm test`.
- Manual E2E (requires `npm start` + a loaded local model): open Research mode, ask a multi-source question, confirm clarifier → plan → parallel **Research worker** rows (not `explore`) → final report with `[n]` and `## References`. Lite profile: set `activePromptProfile: lite` in `~/.minnow/config.json` and repeat a smoke run.
