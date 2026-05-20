# Step 13 verification — Skills framework

## Automated

```bash
npm run test:skills
node scripts/generate-skills-manifest.mjs
node scripts/s13-skills-smoke.mjs
```

With dev server running (`npm start` in another terminal):

```bash
node scripts/s13-skills-smoke.mjs http://localhost:5173
```

Expected: S1–S3 pass (scan + user override). S4–S6 pass when server is up.

### S6 and `SPEEDCHAT_HOME`

The smoke script writes a user override under `SPEEDCHAT_HOME/skills/git-commit/SKILL.md`. The running server only sees that override if it was started with the **same** `SPEEDCHAT_HOME`.

**Coordinated run (S1–S6 all pass):**

```powershell
# PowerShell
$env:SPEEDCHAT_HOME = "$env:TEMP\speedchat-s13-verify"
npm start
# second terminal, same SPEEDCHAT_HOME:
$env:SPEEDCHAT_HOME = "$env:TEMP\speedchat-s13-verify"
node scripts/s13-skills-smoke.mjs http://localhost:5173
```

```bash
# Unix
export SPEEDCHAT_HOME="${TMPDIR:-/tmp}/speedchat-s13-verify"
npm start
# second terminal:
export SPEEDCHAT_HOME="${TMPDIR:-/tmp}/speedchat-s13-verify"
node scripts/s13-skills-smoke.mjs http://localhost:5173
```

If `SPEEDCHAT_HOME` is unset, the script uses an isolated temp home for S1–S3 and prints the path; S6 is skipped unless the server was started with that same path.

## Build

```bash
npm run build
```

## Manual QA

1. `npm start` → focus composer → type `/` → picker lists built-in skills (badges Built-in / Custom).
2. Arrow keys + Enter inserts `/git-commit ` (trailing space).
3. Send `/git-commit` with a short message → user bubble has no raw slash line; footer `[skill: git-commit]`; system prompt includes skill body (network tab or temporary log).
4. Create `~/.speedchat/skills/git-commit/SKILL.md` with distinct body → refresh → picker shows **Custom**; send uses override.
5. `npm run dev` (no server) → built-ins still in picker; user-only skill shows error on send if attempted.

## Result (verifier re-run 2026-05-19)

| Check | Status |
|-------|--------|
| `npm test` | **PASS** (node **67/67**, tsx **109/109**; **176** total) |
| `npm run test:skills` | **PASS** (10/10) |
| `npm run build` | **PASS** |
| `generate-skills-manifest.mjs` | OK (**11** skills) |
| `s13-skills-smoke.mjs` S1–S3 | **PASS** |
| `s13-skills-smoke.mjs` S4–S6 | **PASS** with coordinated `SPEEDCHAT_HOME` + `npm start` (use smoke URL matching server port if 5173 busy) |
| `skill-picker.css` (Impeccable) | OKLCH tokens, flat chrome, label badges |
| `documentation/context.md` | updated (Step 13 skills) |

**Manual deferred:** live composer `/` picker, send injection bubble, user override refresh, Vite-only dev fallback.
