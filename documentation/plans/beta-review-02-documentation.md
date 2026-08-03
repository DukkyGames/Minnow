# Pre-beta documentation review — Minnow

## Executive summary

User-facing documentation (`documentation/manual/`, `README.md`, `documentation/ROADMAP.md`) is **mostly aligned** with the codebase on the big product facts: **8 released core apps**, **5 hidden apps**, **9 modes** (4 in the composer strip), **114 built-in tools** with **8 gated** (1 calendar + 7 email → **106 exposed**), and **no Reef** references in the manual. Hidden apps are documented as gated, not as shipped.

The highest-risk beta issues are **platform install contradictions** (manual says no Linux package; `documentation/releases/v0.0.1.md` documents an AppImage), **stale session limits** (manual still claims a 50-chat cap; code/context migration narrative suggests no hard trim), **skills count drift** (16 bundled skills in `src/skills/builtin-manifest.json` vs “15” everywhere in the manual), and **THIRD_PARTY_NOTICES** covering only icons—not the rest of the dependency stack.

The in-app product wiki (`minnow_docs_*`, `server/product-wiki/catalog.json`) correctly indexes **33 entries** (31 manual pages + `ROADMAP.md` + `THIRD_PARTY_NOTICES.md`) and **does not** include `contributor/`, `maintainer/`, or `guides/`. GitHub Wiki publishing still includes maintainer/contributor trees (by design); that is not in-app but is public if the wiki is enabled.

`documentation/guides/` vs `documentation/contributor/` is **intentional**: guides are redirect stubs; contributor docs are canonical for developers—low duplicate risk, not conflicting content.

---

## Doc drift table (claim vs code)

| Doc claim | Code / authority reality | Severity |
|-----------|---------------------------|----------|
| 8 apps, all core, no toggles | `src/os/app-registry.ts`: 8 `released` + `core`; 5 `hidden` optional | Aligned |
| Compare, Bench, Experts, Calendar, Email gated | `releaseState: 'hidden'` for those ids | Aligned |
| 9 modes; Reef removed | `src/chat/modes/registry.ts`: 9 definitions; Reef absent | Aligned (Reef only in `context.md`, contributor, maintainer) |
| 114 tools, 106 in default build | `BUILT_IN_TOOLS.length === 114`; `appId` calendar 1 + email 7 | Aligned |
| 15 bundled slash skills | `builtin-manifest.json`: **16** skills (`create-pr` missing from manual table) | Medium |
| “Only General” can read Minnow manual | `general` + `onboarding` + **`desktop`** (all groups) include `minnow-docs` | Medium |
| “Minnow keeps the 50 most recent chats” | No `MAX_CHATS` / 50 trim in `src/state`; `context.md` still mentions max 50 in one place—likely stale | Medium |
| Linux: “No packaged build” (`install.md`) | `documentation/releases/v0.0.1.md`: **AppImage** for Linux x86_64 | **High** |
| `modes.md`: Email mode “not in this build” | Email **app** hidden; `email` mode exists for hidden app / transcripts | Low (accurate for users) |
| Tool server port 9473, loopback default | Matches `AGENTS.md` / `context.md` | Aligned |
| `minnow_docs_*` = manual only | `path-filter.mjs` + catalog: `manual/`, `ROADMAP.md`, `THIRD_PARTY_NOTICES.md` | Aligned |
| README “Fifteen ship built in” skills | 16 in manifest | Medium |
| README / README features vs manual | Source Control Center, Expand prompt, Stop all—shipped in product, thin or absent in manual | Medium (missing docs) |

---

## Missing documentation for released features

| Feature (shipped / README-highlighted) | Manual coverage |
|----------------------------------------|-----------------|
| **Source Control Center** (7 sections, Ctrl+1–7, PRs, CI/Checks, Commands palette) | README has full section; `documentation/manual/apps/code.md` only describes sidebar git panel |
| **Expand prompt** (composer rewrite before send) | README; not in `chatting.md` or get-started |
| **Stop all** (agent activity footer) | `context.md`; only in `guides/release-e2e-testing.md` |
| **`/create-pr` built-in skill** | In manifest; not in skills table |
| **Desktop chat mode** (widest tools + manual access) | Not named in `first-chat.md` / `how-minnow-works.md` beyond “desktop surface” |
| **Chat app vs desktop** naming | Overview table is clear; README “Chat app” image row is easy to misread |

---

## Content to remove or gate before beta

| Content | Issue | Recommendation |
|---------|--------|----------------|
| `documentation/guides/release-e2e-testing.md` | Maintainer pre-release checklist; linked from `context.md` | Keep repo-side; do not promote in beta user paths; optional: mark “maintainers only” at top |
| GitHub Wiki `maintainer/`, `contributor/`, `context.md` | Public mirror per `wiki-publishing.md` | OK for contributors; ensure beta users are pointed to in-app **?** manual first (`guides/README.md` already does) |
| `documentation/releases/v0.0.1.md` | Beta + Linux AppImage vs manual | Resolve install story in one place before publishing release notes |
| Stale **50-chat** lines in manual | Misleading support burden | Fix before beta (doc-only) |
| `documentation/THIRD_PARTY_NOTICES.md` | Legal/compliance gap for packaged app | Expand or add process before wide beta (not necessarily in manual) |

**Do not ship as user confusion:** contradictory Linux install instructions between manual and release notes.

---

## Per-file issues (severity + fix)

Paths are under `c:\Users\dukky\Documents\Development\Minnow\`.

### User manual (`documentation/manual/`)

| File | Severity | Issue | Fix |
|------|----------|--------|-----|
| `get-started/install.md` | **High** | Linux row: no packaged build; wiki only | Align with actual beta artifacts (AppImage and/or `package:linux`); match `releases/v0.0.1.md` |
| `get-started/first-chat.md` | Medium | “50 most recent chats” | Remove or replace with current retention behavior (unlimited + ephemeral prune) |
| `chat/chatting.md` | Medium | Same 50-chat claim | Same |
| `chat/skills-and-commands.md` | Medium | “Fifteen ship built in”; table omits `/create-pr` | Say **16**; add row for `create-pr` |
| `README.md` (manual) | Medium | “Fifteen” in skills pointer via `first-chat.md` | Update count |
| `concepts/how-minnow-works.md` | Medium | “General mode is the only composer mode that can read this manual” | Clarify: composer **General**; **Desktop** surface also has `minnow_docs_*`; Build/Plan/Debug use repo/`context.md` |
| `concepts/modes.md` | Low | Minnow manual column only ● for General | Note Desktop (and onboarding) for docs tools; optional footnote on `email` mode vs hidden Email app |
| `apps/code.md` | Medium | No Source Control Center | Add section or link-worthy summary (rails, shortcuts, gh PR/CI)—match README depth or defer README trim |
| `apps/overview.md` | Low | — | Aligned with registry |
| `reference/roadmap.md` | Low | — | Aligned |
| `reference/wiki-and-brain.md` | Low | General + onboarding for `minnow_docs_*` | Optionally mention Desktop |
| `apps/issues.md` | Low | “Settings → Apps → Issues” | Matches `settings-catalog.ts` (`apps` category, `issues` section)—OK |
| All manual relative links | — | Validator: **0 broken** relative `.md` links | — |

### Repo root / top-level docs

| File | Severity | Issue | Fix |
|------|----------|--------|-----|
| `README.md` | Medium | Strong SCC + Expand; manual thinner | Either add manual pages or soften README as “marketing depth” |
| `README.md` | Low | Quick start → `contributor/setup-from-source.md` | Fine for clone; beta installers should also point to `manual/get-started/install.md` |
| `documentation/ROADMAP.md` | Low | — | Aligned with gate story |
| `documentation/context.md` | Medium | Max 50 chats (line ~189); authority for agents | Update to match SQLite behavior (user asked not to edit—flag for maintainers) |
| `documentation/THIRD_PARTY_NOTICES.md` | **High** | Only Material Icon Theme + Uicons | Audit `package.json` dependencies for AGPL/beta distribution expectations |
| `documentation/releases/v0.0.1.md` | **High** | Linux AppImage vs `install.md` | Single source of truth for beta platforms |

### Guides vs contributor

| File | Severity | Issue | Fix |
|------|----------|--------|-----|
| `documentation/guides/README.md` | — | Clear stub → manual/contributor | No change |
| `documentation/guides/*.md` stubs | Low | Redirect only | OK |
| `documentation/guides/release-e2e-testing.md` | Medium | Maintainer QA in `guides/` | Label maintainer-only; not in in-app wiki |
| `documentation/contributor/setup-from-source.md` | Low | Accurate for `npm start`, Node 18+, LM Studio | Matches beta “build from source” path |

### Product wiki / tools

| File | Severity | Issue | Fix |
|------|----------|--------|-----|
| `server/product-wiki/catalog.json` | — | 33 entries; no contributor/maintainer | Regenerate on manual edits via prebuild |
| `src/product-wiki/path-filter.mjs` | — | In-app allowlist correct | — |
| `documentation/maintainer/wiki-publishing.md` | Info | GitHub Wiki includes maintainer | Document that beta users should use in-app **?** |

---

## Checklist answers (numbered)

1. **Stale Reef / hidden as released:** Reef not in manual/README/ROADMAP; hidden apps consistently gated in manual + ROADMAP.
2. **Duplicate guides:** Guides are redirects; contributor is dev canonical—not duplicate bodies.
3. **Broken links:** No broken relative links in `documentation/manual/`; `#not-in-this-release` and `#routing` headings exist.
4. **Maintainer in product wiki:** Not in catalog; GitHub Wiki still publishes maintainer (separate surface).
5. **releases vs beta:** `v0.0.1.md` is explicit open beta + Beta update channel; manual `install.md` describes Stable/Beta channels but not “open beta” wording—minor tone gap.
6. **minnow_docs_* vs manual:** Catalog matches 31 manual files + roadmap + notices; tools do not index contributor/context.
7. **THIRD_PARTY_NOTICES:** Incomplete vs shipped stack.
8. **Setup for beta users:** Windows/macOS narrative in manual is reasonable; **Linux and release asset story is inconsistent**; source setup in contributor doc is accurate.

---

## Authority note

`documentation/context.md` matches code on apps, modes, tools, and wiki split, but still contains **legacy session/chat limits** and **Reef removal** notes appropriate for agents—not user manual content. User manual should not cite `context.md` as end-user help (manual correctly points users to GitHub Wiki for dev material in `wiki-and-brain.md`).

[REDACTED]