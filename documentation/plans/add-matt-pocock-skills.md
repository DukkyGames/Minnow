# Add Matt Pocock productivity and engineering skills

**Status:** Shipped in repo — 19 skills vendored under `src/skills/<id>/`.

## Scope

Import **19 skills** from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).

| Category | Skills |
|----------|--------|
| Productivity (5) | `grill-me`, `grilling`, `handoff`, `teach`, `writing-great-skills` |
| Engineering (14) | `ask-minnow`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `implement`, `improve-codebase-architecture`, `prototype`, `resolving-merge-conflicts`, `setup-minnow-skills`, `tdd`, `to-issues`, `to-prd`, `triage` |

## Implementation

- [x] `scripts/matt-pocock-preserves/skill-catalog.json` + `apply-minnow-patches.mjs`
- [x] `scripts/sync-matt-pocock-skills.mjs` — GitHub fetch, `SKILL.upstream.md`, lock file
- [x] Vendored `src/skills/<id>/` (supplementary files included)
- [x] `npm run prebuild` → `builtin-manifest.json` (33 built-ins)
- [x] `test/skills-matt-pocock.test.mjs` + `npm run test:skills` + `npm test`
- [x] `documentation/context.md`, `AGENTS.md`

## Minnow patches

| Upstream | Minnow |
|----------|--------|
| `ask-matt` | `ask-minnow` |
| `setup-matt-pocock-skills` | `setup-minnow-skills` |
| `/review` | `/code-review` |
| Cursor `/compact` | `/handoff` or new chat |

## Sync

```bash
npm run matt-pocock-skills:sync
# optional: MATT_POCOCK_SKILLS_REF=<sha|branch> MATT_POCOCK_SKILLS_SYNC_STRICT=1
```

Lock: `skills-lock.json` → `matt-pocock-skills.commitSha` + per-skill file hashes.

## Todos (completed)

- [x] catalog-patches
- [x] sync-script
- [x] vendor-run
- [x] manifest
- [x] tests
- [x] docs
