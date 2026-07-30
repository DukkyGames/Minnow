# User manual wiki split

Plan for the user-focused in-app wiki content under `documentation/manual/`, separate from maintainer guides and `context.md`.

## Information architecture

- [x] `manual/README.md` — manual home, help entry (?), table of contents
- [x] `manual/get-started/install.md` — packaged install, first launch, LM Studio/Ollama via Settings
- [x] `manual/get-started/first-chat.md` — desktop, composer, four modes, first message
- [x] `manual/chat/modes-and-skills.md` — modes, slash skills, context ring, when to use what
- [x] `manual/apps/overview.md` — eight released apps in UI language (no gate ticket dump)
- [x] `manual/apps/code.md`
- [x] `manual/apps/research.md`
- [x] `manual/apps/brain.md`
- [x] `manual/apps/models.md`
- [x] `manual/apps/issues.md`
- [x] `manual/apps/scheduler.md`
- [x] `manual/apps/settings.md`
- [x] `manual/reference/keyboard-shortcuts.md` — user tone, no source map
- [x] `manual/reference/configuration.md` — Minnow home, backup `.key`, not settings-reference dump
- [x] `manual/reference/troubleshooting.md` — packaged-first troubleshooting
- [x] `manual/reference/wiki-and-brain.md` — official wiki vs Brain
- [x] `manual/reference/roadmap.md` — short pointer; full `ROADMAP.md` stays catalog entry

## Catalog and pipelines

- [x] In-app catalog: `documentation/manual/`, `ROADMAP.md`, `THIRD_PARTY_NOTICES.md`
- [x] GitHub Wiki: full corpus via `collectGitHubWikiPublishPaths` (54 pages staged)
- [x] `documentation/contributor/` — dev guides moved from `guides/`
- [x] `documentation/guides/` — redirect stubs to manual or contributor
- [x] `minnow_docs_*` and prompts — manual-only product help

## Follow-up (optional)

- [x] Run `npm run wiki:generate` before release
- [x] Cross-link `guides/setup.md` to manual install and contributor setup
