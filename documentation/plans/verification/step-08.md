# Step 08 verification — Work Agents

## Implementer fix (2026-05-19)

`server/work-agents/registry.js` aligned with `server/prompts/parse.js`:

- `parsePromptMarkdown` returns a **flat** object (`id`, `kind`, `label`, `body`, …), not `{ frontMatter }` or `{ markdownBody }`.
- `parseWorkAgentMeta` reads `parsed.kind`, `parsed.id`, etc.
- `readWorkAgentPrompt` uses `parsed.body`; raw user override files (no YAML) fall back to file text with `source: "override"`.

**Implementer smoke (PASS):** temp `SPEEDCHAT_HOME`, `PORT=5185`, `npm start` → `GET /api/work-agents` (≥4 agents), `PUT`/`GET` builder prompt override.

## Prerequisites

- Node.js 20+
- Repo root: `c:\Users\dukky\Documents\Development\SpeedChat`

## Automated tests

```bash
npm test
```

Work-agent only:

```bash
npx tsx --test test/work-agents/**/*.test.mjs
```

**Expected:** all tests pass (11 work-agent tests + existing suites).

## Build

```bash
npm run build
```

**Expected:** `tsc` and `vite build` exit 0.

## Manual checks (`npm start`)

1. `curl http://localhost:5173/api/work-agents` — JSON lists ≥4 agents (`default`, `builder`, `planner`, `reviewer`, `researcher`).
2. Open app with `?dev=1` — **Work agent (dev)** select appears above composer.
3. Select **Builder**, send a message — status shows `Generating reply (Builder)…`; network uses chat model unless agent sets `providerId`/`modelId` in front matter.
4. Switch mode to **Plan** with **Auto from mode** checked — work agent follows mode default (`planner`).
5. `PUT` prompt override:
   ```bash
   curl -X PUT http://localhost:5173/api/work-agents/builder/prompt \
     -H "Content-Type: application/json" \
     -d "{\"profile\":\"full\",\"content\":\"# Custom builder\\nTest override.\"}"
   ```
   Then `GET .../builder/prompt?profile=full` — `source: "override"`.
6. Reload app — `workAgentId` persists for the chat (`sessions/state.json`).

## Files touched (implementer checklist)

- `src/agents/*` — registry, binding, init, prompt API, set-work-agent stub
- `src/chat/prompts/work-agents/` — five built-ins + template
- `server/work-agents/` — registry loader + HTTP routes
- `src/tools/loop.ts` — binding + tool filter + status label
- `src/ui/work-agent-dev.ts` — dev selector
- `test/work-agents/*.test.mjs` — registry + binding unit tests
