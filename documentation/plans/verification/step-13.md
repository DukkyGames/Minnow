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

## Result (implementer re-verify)

| Check | Status |
|-------|--------|
| `npm test` | pass (node 43/43, tsx 98/98; **141** total) |
| `npm run test:skills` | pass (10/10) |
| `npm run build` | pass |
| `generate-skills-manifest.mjs` | OK (10 skills) |
| `s13-skills-smoke.mjs` S1–S3 | pass |
| `s13-skills-smoke.mjs` S4–S6 | pass with coordinated `SPEEDCHAT_HOME` + `npm start` |
| `import.meta.glob` in Node/tsx | guarded/lazy in `src/skills/client.ts` |
| `documentation/context.md` | updated (Step 13 skills) |

Ready for verifier re-run (no commit).
