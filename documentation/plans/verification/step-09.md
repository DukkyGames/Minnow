# Step 09 verification — Sub-agent orchestration

## Prerequisites

- Node.js 20+
- Repo root: `c:\Users\dukky\Documents\Development\Minnow`

## Automated tests

```bash
npm test
```

Sub-agent only:

```bash
npx tsx --test test/sub-agents/**/*.test.mts
```

**Expected:** all sub-agent tests pass (spawn, cancel, aggregate, restart, config, tools).

## Build

```bash
npm run build
```

**Expected:** `tsc` and `vite build` exit 0.

## Config API (`npm start`)

```bash
curl http://localhost:5173/api/config/sub-agents
```

**Expected:** JSON with `enabled`, `globalMaxConcurrent`, `types` (merged user file or empty types + defaults on client).

```bash
curl -X PUT http://localhost:5173/api/config/sub-agents \
  -H "Content-Type: application/json" \
  -d "{\"enabled\":true,\"globalMaxConcurrent\":3,\"types\":{}}"
```

## Optional smoke

```bash
node scripts/sa09-sub-agent-smoke.mjs http://localhost:5173
```

## Acceptance checklist

- [ ] `spawn_sub_agent` returns aggregate JSON when `wait: true` (unit tests with mock runner).
- [ ] `globalMaxConcurrent` queues excess runs (`orchestrator-spawn.test.mts`).
- [ ] `explore` type omits `execute_command` from tool schema (`sub-agent-tools.test.mts`).
- [ ] `cancel_sub_agent` cancels mock long run (`orchestrator-cancel.test.mts`).
- [ ] `restartSubAgent` new `runId` + empty messages (`orchestrator-restart.test.mts`).
- [ ] Parent abort calls `cancelAllForParentTurn` (wired in `loop.ts`).
- [ ] `documentation/context.md` sub-agents section updated.

## Implementer decisions

| Question | Decision |
|----------|----------|
| Queue vs error when over cap | **Queue** with `status: "queued"` until a slot frees |
| `wait: false` | Supported; returns `{ runId, status }` immediately |
| Transcript retention | Off by default; ephemeral messages on run state only |
