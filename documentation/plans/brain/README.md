# Brain / CORTEX — issue breakdown

A self-maintaining knowledge + code-context engine for Minnow. The full design lives in the
original CORTEX brief; these files split it into **11 PR-sized issues**, each self-contained and
buildable by an agent who has not read the others.

CORTEX is the internal architecture; **Brain** is the Minnow app. The system separates knowledge by
its nature and gives each kind its own engine, then bridges them:

| | Volatile + Exact (code) | Stable + Interpretive (knowledge) |
|---|---|---|
| Representation | deterministic SQLite index | LLM-synthesized markdown wiki |
| Engine | LSP symbol graph + PageRank | the evolved memory/vector engine |
| Truth source | the code itself | decisions + synthesis |

Everything is **local-first and internal to Minnow** — no separate service, **no MCP surface**, no
chat UI, no cloud sync, no fact-fine-tuning.

## Issues

| # | Title | Depends on |
|---|---|---|
| [MIN-B1](MIN-B1-shared-engine.md) | Extract shared vector engine into `server/engine/` | — |
| [MIN-B2](MIN-B2-wiki-store.md) | Wiki store: paths + sandbox, CRUD, migration, bootstrap | B1 |
| [MIN-B3](MIN-B3-brain-routes-retrieve-adapter.md) | Brain routes + scoped retrieve + memory adapter | B2 |
| [MIN-B4](MIN-B4-wiki-tools-prompt.md) | Wiki tools + prompt/routing integration | B3 |
| [MIN-B5](MIN-B5-brain-app-shell.md) | Brain app shell + wiki-side UI sections | B3 |
| [MIN-B6](MIN-B6-lsp-extensions.md) | LSP: documentSymbol / workspace-symbol / callHierarchy | — |
| [MIN-B7](MIN-B7-code-index-backbone.md) | Code index backbone: SQLite + indexer + rank + tools | B6, B4 |
| [MIN-B8](MIN-B8-brain-code-ui.md) | Brain app: Code section UI | B5, B7 |
| [MIN-B9](MIN-B9-bridge-anchors.md) | The Bridge: anchors + `explain_symbol` + anchor drift | B7, B5 |
| [MIN-B10](MIN-B10-cascade.md) | The Cascade: Merkle staleness + incremental reindex + git hook | B7, B9 |
| [MIN-B11](MIN-B11-polish.md) | Polish (optional, post-MVP) | B10 |

## Dependency graph

```
B1 ──► B2 ──► B3 ──┬──► B4 ──┐
                   └──► B5    ├──► (B4 needed by) B7
B6 ─────────────────────────►┘
                   B6 ─► B7 ─► B8
                              B7 ─► B9 ─► B10 ─► B11
                   B5 ─────────► B9
```

## The seven design principles (apply to every issue)

1. Separate source-of-truth from the derived layer; never hand-edit the derived layer.
2. Route by knowledge type, not by tool (volatile+exact vs stable+interpretive).
3. Derive structure deterministically (LSP); synthesize meaning with an LLM (needs lint).
4. Stale-track everything: every derived artifact carries an input hash and knows when it's dirty.
5. Progressive disclosure: start at the map, zoom on demand, never preload bodies.
6. Plain files you own: markdown + SQLite + git.
7. Fresh beats clever: a correct map of today's code beats a brilliant summary of last week's.

## Corrections carried from codebase review (do not repeat these mistakes)

1. Tool permission enum is `'full' | 'ask' | 'off'` (`src/ui/settings-plugins.ts:154`). No-prompt =
   seed `'full'`, **not** `'allow'`. `defaultToolsJson()` seeds enabled tools `'ask'`
   (`server/config/home.js:310`).
2. Path sandboxing is **new**. Memory's `entryFilePath()` only validates UUIDs
   (`server/memory/paths.js:37`); the runtime's `resolveSafePath` (`server/runtime/middlewares.js`)
   is workspace-scoped, not brain-scoped. Brain needs its own tested traversal guard.
3. Synthesis is five files: `synthesis.js`, `synthesis-routes.js`, `synthesis-state.js`,
   `skill-synthesis.js`, `synthesis-config.js`.
4. Vectors key on `id` (UUID), not path — migration must preserve ids; moving/renaming a page must
   not break its vector.
5. Workspace scoping happens **before** the engine retrieve call (`server/memory/retrieve.js:83`) —
   filter pages in the route, keep the engine pure.
6. New tool ids must be **back-filled** into existing configs on load (`defaultToolsJson()` only runs
   at first-run seed).
7. FOUC: add base `.brain-page` rules to `src/styles/global.css:106`, not only the lazy
   `brain-page.css`.

## On-disk layout (`~/.minnow/brain/`)

```
~/.minnow/brain/
├── index.md  log.md  schema.md          # LLM-maintained catalog / changelog / routing+conventions
├── catalog.json                         # REBUILDABLE cache of page metadata (frontmatter is truth)
├── vectors.json  proposals.json         # engine sidecars (keyed by page id)
├── pages/                               # the wiki tree (nested .md; frontmatter + [[folder/slug]])
│   ├── facts/                           # migration target for existing flat memory entries
│   ├── <domain>/ …                      # global pages (edgeflight/, minnow/, grimms-bluff/, …)
│   └── workspaces/<workspace-key>/      # per-workspace containers
├── sources/                             # raw ingested non-code sources (immutable)
└── code/                                # DERIVED — never hand-edited
    └── <workspace-key>.db               # SQLite: symbols, edges, file_hashes, anchors, FTS5
```

Code repos stay where they live (workspace roots from the MRU in `server/workspace/root.js`); the
index reads them in place and never copies code into `sources/`. **One global brain** (shared wiki +
sources); **per-workspace code indexes**. `workspace-key` = slug of `getWorkspacePath()`
(`src/state/workspace.ts:12`).
