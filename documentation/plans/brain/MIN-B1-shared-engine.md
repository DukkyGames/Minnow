# MIN-B1 — Extract the shared vector engine into `server/engine/`

**Phase 1 of 7 (Build order). Foundation — nothing depends on Brain until this lands.**

## Goal

Move the six generic, reusable modules out of `server/memory/` into a neutral, root-parameterized
`server/engine/` that both `memory` (now) and `brain` (later, MIN-B2+) import. **No behavior change.**
The existing memory feature must keep working bit-for-bit; this is a pure refactor that makes the
engine reusable by a second consumer.

## Why

The wiki (MIN-B2) and the memory feature need the same embedding/vector/retrieve machinery against
different root directories. Today that machinery is hard-wired to `getMemoryDir()`. We extract it once,
parameterize the disk paths, and avoid a shim layer (locked decision: **shared module, no shim**).

## Depends on

Nothing. Do this first.

## Current state (verified)

`server/memory/` contains:
```
backup.js  embeddings.js  middleware.js  paths.js  proposals.js  retrieve.js
routes.js  skill-synthesis.js  store.js  synthesis-config.js  synthesis-routes.js
synthesis-state.js  synthesis.js  vector-store.js  vector-sync.js
```

The six generic modules to extract: `embeddings.js`, `vector-store.js`, `vector-sync.js`,
`retrieve.js`, `proposals.js`, `backup.js`.

The remaining files (`store.js`, `routes.js`, `middleware.js`, `paths.js`, the five `synthesis*` /
`skill-synthesis` files) are memory-specific and **stay** in `server/memory/` for now (they move or
become adapters in MIN-B2/MIN-B3).

## Scope / files

### Create `server/engine/`
Move the six modules here. Two of them are already pure (no disk path assumptions) and move as-is:
- `retrieve.js` — pure ranking/hybrid retrieval. **Do not change its signature** (`retrieveMemoryBlock`,
  `retrieveMemoryBlockHybrid`); MIN-B3 wraps it, callers must not move yet.
- `embeddings.js` — pure embedding calls.

Three touch disk and must be **parameterized by an injected paths object**:
- `vector-store.js`
- `proposals.js`
- `backup.js`

The sixth, `vector-sync.js`, orchestrates the above — thread the paths object through it.

### Paths object contract
Disk-touching modules must accept:
```js
{ rootDir, vectorsPath, proposalsPath, backupsDir }
```
No module in `server/engine/` may import `getMemoryDir()` or any memory-specific path helper. Resolve
nothing from globals; everything comes from the injected object.

### Repoint memory
`server/memory/*` constructs the paths object from `getMemoryDir()` (`server/memory/paths.js`) and
passes it into the engine modules. Delete the now-moved files from `server/memory/`. No logic should
be duplicated between `memory` and `engine`.

## Step-by-step

1. `git mv` the six files into `server/engine/`; fix all relative imports inside them.
2. In `vector-store.js`, `proposals.js`, `backup.js`, replace every hard-coded path derivation with a
   field read from the injected paths object. Add the paths object as the first constructor/factory
   argument (or module-init argument, matching the current call style).
3. Thread the paths object through `vector-sync.js`.
4. In `server/memory/`, build the paths object from `getMemoryDir()` and pass it to each engine module
   at its call sites (`store.js`, `routes.js`, `synthesis*`, `vector-sync` callers).
5. Grep the whole repo for imports of the moved files (`server/memory/embeddings`, etc.) and repoint
   them to `server/engine/`.

## Tests

- The **entire existing `test/memory/*` suite must pass unchanged.** This is the primary correctness
  signal for a refactor.
- Add `test/engine/vector-store.test.mjs`: construct the vector store with an arbitrary temp
  `rootDir`, write a vector keyed by a UUID, read it back, assert round-trip and that files land under
  the injected `rootDir` (not under any memory dir).

## Acceptance criteria

- [ ] `server/engine/` contains the six modules, each path-parameterized (no memory imports).
- [ ] `server/memory/` imports from `server/engine/`; the six files no longer exist under `memory/`.
- [ ] No logic is duplicated between `memory` and `engine`.
- [ ] `retrieve.js` / `embeddings.js` signatures are byte-for-byte unchanged.
- [ ] `npm test` (memory + new engine smoke test) green; typecheck + lint clean.

## Out of scope

- Any `server/brain/` code, any new on-disk layout, any new routes/tools/UI.
- Changing retrieve/embeddings behavior or signatures.
