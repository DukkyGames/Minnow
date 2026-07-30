# MIN-406 — Unified Minnow wiki

## Goal

Ship one versioned product-help corpus that users can browse in Minnow, publish to GitHub Wiki, and retrieve from desktop chat without mixing official documentation with the user's editable Brain.

## Product decisions

- `documentation/` remains the source of truth.
- `#/wiki` is a focused overlay rather than a ninth dock app. This keeps the shipped app set narrow and leaves Brain responsible for personal knowledge.
- Product documentation is read-only at runtime. Brain remains writable and workspace-scoped.
- The GitHub Wiki is a generated mirror. Maintainers do not edit generated pages directly.
- Engineering plans, agent memory, and archives are excluded from search and publication.

## Information architecture

| Section | Canonical source | Runtime | GitHub Wiki |
|---|---|---|---|
| Start here and user guides | `documentation/guides/` | Included | Included |
| Developer reference | `documentation/context.md`, `documentation/plugins/`, `documentation/agent-packs/`, `documentation/design-system/` | Included | Included |
| Product roadmap | `documentation/ROADMAP.md` | Included | Included |
| Maintainer runbooks | `documentation/maintainer/` | Included | Excluded |
| Feature plans and specs | `documentation/plans/`, `documentation/specs/` | Excluded | Excluded |
| Agent memory and archives | `documentation/memory/`, `documentation/archive/`, `documentation/MEMORY.md` | Excluded | Excluded |

## Architecture

1. `scripts/generate-product-wiki-catalog.mjs` scans the allowlisted documentation tree and emits a deterministic catalog with titles, summaries, headings, sections, and hashes.
2. `server/product-wiki/` provides safe catalog, search, and page reads rooted at the installed application documentation directory.
3. `/api/product-wiki/*` serves the in-app reader.
4. `minnow_docs_search`, `minnow_docs_read`, and `minnow_docs_list` expose the same corpus to chat.
5. The `#/wiki` overlay provides navigation, ranked search, deep links, responsive reading, and sanitized Markdown rendering.
6. `scripts/publish-github-wiki.mjs` creates a deterministic staging directory used by the GitHub Wiki workflow.

## Security and reliability

- Reject absolute paths, traversal, non-Markdown files, excluded folders, and symlink escapes.
- Resolve documentation from the application root, never the active user workspace.
- Sanitize rendered Markdown and open external links with `noopener noreferrer`.
- Cap tool reads and search limits.
- Keep generated output deterministic; timestamps are not stored in catalogs or wiki pages.
- Treat repository documentation as trusted shipped product text, while preserving normal Markdown sanitization in the renderer.

## Todo

- [x] Add deterministic product-wiki catalog generation.
- [x] Add safe server catalog/search/read APIs.
- [x] Add dedicated read-only chat tools and mode/prompt routing.
- [x] Add the responsive `#/wiki` overlay and menubar entry point.
- [x] Add product roadmap and publishing runbook.
- [x] Add GitHub Wiki staging script and sync workflow.
- [x] Add focused catalog, path, API, tool, and UI tests.
- [x] Run typecheck, focused tests, production build, and a GUI walkthrough.
- [x] Update `documentation/context.md` with the shipped architecture.

## Acceptance checks

- Opening `#/wiki` shows the generated documentation catalog.
- Searching by title, heading, path, or body returns ranked results.
- A deep link opens the same article after reload.
- Relative Markdown links stay inside the viewer; external links are clearly external.
- Desktop chat can search, list, and read official Minnow documentation without Brain.
- The generated GitHub Wiki staging tree contains Home, Sidebar, Roadmap, and allowlisted pages only.
- Catalog generation, typecheck, tests, and build pass on Linux and Windows-compatible paths.
