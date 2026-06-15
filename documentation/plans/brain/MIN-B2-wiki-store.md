# MIN-B2 — Wiki store: paths + sandbox, page CRUD, migration, bootstrap

**Phase 2 of 7. The storage layer for the wiki — no HTTP routes or UI yet.**

## Goal

Stand up the on-disk Brain wiki tree at `~/.minnow/brain/`, with: page CRUD over a real nested file
tree; frontmatter parse/serialize; path-based wikilink extraction; a **tested path-traversal sandbox**;
one-time idempotent migration from the existing `memory` store (preserving ids + vectors); and
first-run scaffolding of `index.md`/`log.md`/`schema.md`/`catalog.json`.

## Why

Knowledge rots in flat auto-facts. The wiki replaces flat entries with a cross-linked, nested markdown
tree where frontmatter is the source of truth and `catalog.json` is a rebuildable cache. This issue
delivers everything needed to read/write that tree safely; MIN-B3 puts it behind HTTP.

## Depends on

**MIN-B1** — imports the parameterized `server/engine/` modules (`vector-sync`, `backup`).

## On-disk layout to create (`~/.minnow/brain/`)

```
~/.minnow/brain/
├── index.md  log.md  schema.md     # seeded on bootstrap (LLM-maintained thereafter)
├── catalog.json                    # rebuildable cache; frontmatter is truth
├── vectors.json  proposals.json    # engine sidecars, keyed by page id (copied at migration)
├── pages/
│   ├── facts/                      # migration target for flat memory entries
│   ├── <domain>/                   # global pages
│   └── workspaces/<key>/           # per-workspace containers
├── sources/                        # raw ingested non-code sources (created empty)
└── code/                           # created empty; populated by MIN-B7
```

## Scope / files

### `server/brain/paths.js`
- `getBrainDir()`, `getBrainPagesDir()`, `getBrainSourcesDir()`, `getBrainCodeDir()` — mirror the
  style of `server/memory/paths.js` and `server/calendar/paths.js`.
- **`resolvePagePath(relPath)` — the new sandbox.** This is the security-critical function and must be
  bullet-proof:
  - Normalize `relPath` under `pages/`.
  - Reject: absolute paths, any `..` segment, leading slash/backslash, drive letters, null bytes.
  - Enforce a `.md` extension.
  - After resolving, assert via `fs.realpath` (or equivalent) that the resolved path is still inside
    the real pages root (defeats symlink escape).
  - Return the absolute path on success; throw a typed error on rejection.
  - Note: do **not** rely on memory's `entryFilePath()` (it only validates UUIDs) or the runtime's
    `resolveSafePath` (workspace-scoped, not brain-scoped). This is genuinely new.

### `server/brain/store.js`
Page CRUD over the real tree plus `catalog.json`:
- **Frontmatter parse/serialize** — port and extend `server/memory/store.js:128-156`.
- **Path-based wikilink extraction**: `[[folder/slug]]` → relative paths in `links[]`. Duplicate slugs
  are allowed; resolution is by relative path, not by unique slug.
- `createPage`, `readPage`, `updatePage`, `deletePage`, `listPages`/`tree`.
- `appendLog(entry)` — append to `log.md`.
- `rebuildIndex()` — regenerate `index.md` catalog view.
- `rebuildCatalog()` — re-scan the disk tree and rebuild `catalog.json` from frontmatter. The catalog
  is a cache and **never authoritative** (file tools and the LLM can mutate pages directly, so it must
  be reconstructable from disk alone).
- **Drop** `MAX_BODY_BYTES` / `MAX_ENTRIES` (`server/memory/store.js:24`) — the wiki has no entry cap.
- Every write: append to `log.md` **and** schedule a vector sync keyed by the page `id` (via
  `server/engine/vector-sync`).

### Page frontmatter (source of truth)
```yaml
id: <uuid>            # stable across moves/renames; vectors key on this
title: <string>
tags: []
source: user | agent | synthesis | ingest
summary: <string>
pinned: false
createdAt: <iso>
updatedAt: <iso>
anchors: []           # reserved — populated in MIN-B9 (bridge)
status: current       # current | stale | orphan
input_hash: <hash>    # hash of sources + anchored symbol signatures (cascade, MIN-B10)
```
`catalog.json` additionally stores derived fields: `path`, `slug`, `folder`, `links`.

### `server/brain/migrate.js`
One-time, **idempotent** migration invoked from bootstrap:
- Each memory entry → `pages/facts/<slug>.md`, **preserving the original `id` and timestamps**
  (`createdAt`/`updatedAt`).
- `rebuildCatalog()` afterward.
- Copy `vectors.json` + `proposals.json` **verbatim** (vectors key on the UUID `id`, which is
  preserved, so they keep matching).
- Archive the old `memory/` directory via `server/engine/backup` (**no delete**).
- Set a `migratedFromMemory` flag so it never runs twice.
- Running migration a second time must be a no-op (no duplicate pages, identical catalog).

### Bootstrap — `server/config/home.js`
Add `ensureBrainStore()` (call it from the existing first-run/config-load path):
- Create the directory tree if absent.
- Seed `index.md`, `log.md`, `schema.md`, `catalog.json` with starter content (schema.md holds the
  routing conventions — fleshed out in MIN-B4).
- Trigger `migrate.js` once.

## Step-by-step

1. Write `paths.js` with the sandbox first; write its tests; make them pass before anything else.
2. Write `store.js` CRUD + frontmatter + wikilink extraction + catalog rebuild.
3. Wire vector-sync-on-write keyed by `id`.
4. Write `migrate.js`; test idempotency and id/vector preservation.
5. Wire `ensureBrainStore()` into `home.js` bootstrap.

## Tests (`test/brain/`)

- **Path-sandbox traversal rejection** (highest priority): absolute path, `..` segment, leading slash,
  drive letter, non-`.md` extension, and a symlink that escapes the root — each must throw.
- Page CRUD round-trip over a nested tree (create in `facts/`, in `<domain>/foo/`, read, update, delete).
- Path-based wikilink extraction; backlink computation; orphan detection.
- `rebuildCatalog()` reconstructs `catalog.json` from disk after the file is deleted.
- Migration: ids + timestamps + vectors preserved; running twice is a no-op; old `memory/` archived.

## Acceptance criteria

- [ ] Fresh start seeds the tree and `index/log/schema.md` + `catalog.json`.
- [ ] Existing memory entries migrate into `pages/facts/` with ids, timestamps, and vectors intact.
- [ ] The sandbox rejects every traversal case, each proven by a test.
- [ ] `rebuildCatalog()` works from disk alone (catalog is never authoritative).
- [ ] `npm test` (brain store + sandbox + migration) green; typecheck + lint clean.

## Out of scope

- HTTP routes, tools, retrieve scoping, synthesis relocation, ingest, lint, any UI (later issues).
