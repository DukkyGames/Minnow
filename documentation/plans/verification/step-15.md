# Step 15 verification — UI Designer

## Automated

```bash
npm run build
npm run test:ui-designer
tsx --test test/ui-designer/**/*.test.mts
node scripts/step15-smoke.mjs
```

With dev server (`npm start`, same `SPEEDCHAT_HOME` if testing meta over HTTP):

```bash
node scripts/step15-smoke.mjs http://localhost:5173
```

Expected: all **U1–U6** and **I1–I4** PASS; `npm test` includes `test/ui-designer/*.test.mjs`.

## Unit coverage

| ID | Command | Expected |
|----|---------|----------|
| U1–U3 | `test/ui-designer/config.test.mts` | Model resolution + error when no fallback |
| U4–U5 | `test/ui-designer/tools.test.mts` | Allowlist + plan mode write block |
| U6, I4 | `test/ui-designer/skill.test.mts` | Skill id + `IMPECCABLE_PREFLIGHT` injection |

## Integration smoke

| ID | Check | Expected |
|----|-------|----------|
| I1 | `config.json` / `GET /api/config/meta` | `uiDesigner` defaults present |
| I2 | `run_impeccable` detect | Non-spawn error |
| I3 | screenshot fixture | base64 length > 100 |
| I4 | skill augment | `mutation=closed` in plan mode |

## Manual (minimum)

1. `npm start`, Chrome `--remote-debugging-port=9222`, vision model selected.
2. `/ui-designer plan` — audit/shape; no repo file writes.
3. Set `uiDesigner.modelId` in config — request uses that model when configured.

## Result (implementer)

| Check | Status |
|-------|--------|
| `npm run build` | (run verifier) |
| `npm run test:ui-designer` | (run verifier) |
| `npm test` | (run verifier) |
| Step 14 impeccable | Required — skill present at `src/skills/impeccable/SKILL.md` |
