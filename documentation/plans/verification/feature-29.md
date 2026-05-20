# Feature 29 — All full permissions — verification

**Backlog:** F6 · `feature-29-all-full-permissions`  
**Plan:** [`documentation/plans/Build out/feature-29-all-full-permissions.md`](../Build%20out/feature-29-all-full-permissions.md)

## Plan sign-off

- [x] Build plan reviewed (Epic F6 deliverable template)

## Automated

```bash
npm test
npx tsx --test test/tools/config-bulk-permissions.test.mts
```

| Check | Status |
|-------|--------|
| `config-bulk-permissions.test.mts` | Run with `npm test` |
| Full `npm test` | Run before ship |

## Manual QA

1. `npm start` → Settings → Tools → **All full permissions** → confirm → spot-check `read_file`, `execute_command`, `web_search` → **Full permission**.
2. Chat triggers `read_file` in workspace → no approval strip.
3. **Reset to defaults** → default-on tools **Requires permission**; file tools **Disabled**.
4. Set Brave key → reset → key still present.
5. Filesystem **Restrict to workspace** → all-full → tool outside workspace → approval still appears.
6. Stop server → all-full → restart → permissions still **full**.
7. Reload page → permissions persisted.
8. Re-enter Settings → Tools → bulk buttons work after navigation away.

## Sign-off

| Criterion | PASS |
|-----------|------|
| Bulk buttons above filesystem block | |
| Confirm + cancel behavior | |
| All built-ins → `full` persisted | |
| Reset matches `defaultToolConfig()`, key + `mcp__*` preserved | |
| Filesystem radios independent | |

**Verifier:** _post-implementation_
