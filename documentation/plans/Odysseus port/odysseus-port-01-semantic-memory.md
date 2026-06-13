# Odysseus Port 01 — Semantic Memory And Embeddings

Tier: 1  
Effort: M-L  
Priority: High  
Status: Planned  
Depends on: #13 for untrusted memory wrapping  
Linear: [MIN-122](https://linear.app/minnowai/issue/MIN-122/odysseus-port-01-semantic-memory-and-embeddings)

## Goal

Upgrade Minnow memory retrieval from keyword scoring to hybrid keyword + semantic vector retrieval while keeping the current offline-first memory behavior. This should make "remember how we handled X" recall work even when the user asks with paraphrased language.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#13** (wrap retrieved memory as untrusted) |
| npm packages | Local embedder TBD — candidates: `@xenova/transformers` (transformers.js), `fastembed` Node port, or `onnxruntime-node` + bundled ONNX model. Evaluate package size vs quality in Phase 1 spike. |
| External binaries | None for local v1; optional remote embeddings server |
| Disk space | ~50–200 MB for local embedding model cache under `~/.minnow/models/embeddings/` |
| Credentials | Provider embeddings API key (optional backend) via existing provider secrets + #12 |
| Estimated effort | 5–8 days |

## Prerequisites & Deliverables

| Deliverable | Description |
|-------------|-------------|
| `server/memory/embeddings.js` | Pluggable local + provider embedder |
| `server/memory/vector-store.js` | Sidecar JSON vector index |
| Hybrid retrieval | `retrieveMemoryBlockHybrid()` with keyword fallback |
| Vector sync on CRUD | Upsert/delete on memory entry writes |
| Settings UI | Embeddings toggle, backend, model, blend weight, reindex |
| Reindex API | `/api/memory/embeddings/reindex` |
| Tests | Cosine math, hybrid scoring, timeout fallback, CRUD sync |

## Verified Source Context

- Odysseus reference:
  - `services/memory/memory_vector.py` — ChromaDB `MemoryVectorStore` (`add`, `remove`, `search`, `rebuild`).
  - `src/embeddings.py` — `EmbeddingClient`, `FastEmbedClient`, `get_embedding_client()`.
  - `src/embedding_lanes.py` — multi-lane dedup (`LANE_FASTEMBED`, `LANE_CUSTOM`).
  - Hybrid retrieval in `src/chat_processor.py` — BM25 + vector (Minnow v1 simplifies to keyword + cosine).
- Minnow memory store: `server/memory/store.js` (`createEntry`, `updateEntry`, `deleteEntry`).
- Minnow memory retrieval: `server/memory/retrieve.js` (`scoreEntry`, `retrieveMemoryBlock`, `formatMemoryBlock`).
- Minnow memory paths: `server/memory/paths.js`.
- Minnow memory API: `server/memory/routes.js` and `server/memory/middleware.js`.
- Client types: `src/memory/types.ts`, client `src/memory/client.ts`.
- Settings: memory section inline in `src/ui/settings-sections.ts` (no standalone `settings-memory.ts` yet).

## Files to Create

| Path | Purpose |
|------|---------|
| `server/memory/embeddings.js` | `getEmbedder`, `embedTexts`, local + provider backends |
| `server/memory/vector-store.js` | JSON vector index CRUD + cosine similarity |
| `src/ui/settings-memory-embeddings.ts` | Embeddings subsection UI (or extend settings-sections) |
| `test/memory/embeddings.test.mjs` | Embedder interface tests |
| `test/memory/vector-store.test.mjs` | Vector CRUD + cosine tests |
| `test/memory/hybrid-retrieve.test.mjs` | Hybrid scoring + fallback tests |

## Files to Modify

| Path | Change |
|------|--------|
| `server/memory/store.js` | Hook vector upsert/delete on CRUD |
| `server/memory/retrieve.js` | Add `retrieveMemoryBlockHybrid`, keep sync keyword path |
| `server/memory/routes.js` | Add `/embeddings/status`, `/embeddings/reindex` |
| `server/memory/middleware.js` | Register new routes |
| `server/config/home.js` | Default `memory.embeddings` config block |
| `server/config/validators.js` | Validate embeddings config |
| `src/memory/types.ts` | Extend `MemoryConfig` with embeddings fields |
| `server/providers/paths.js` | Add optional `embeddingsPath` (default `/v1/embeddings`) |
| `server/providers/auth-headers.js` | Reuse for provider embeddings calls |
| `src/ui/settings-sections.ts` | Wire embeddings UI into Memory section |
| `documentation/context.md` | Document hybrid retrieval and config |

## Decisions

- Use a bundled local embeddings backend first so memory works offline.
- Add provider `/v1/embeddings` as an optional secondary backend behind the same interface.
- Use a sidecar JSON vector index under `~/.minnow/memory/vectors.json` (not ChromaDB — simpler for Minnow's file-backed model).
- Do not block send-time memory injection on embedding latency; fallback to current keyword retrieval when embedding fails, times out, or is disabled.
- Use `0.5 * keyword + 0.5 * cosine` hybrid score as Minnow v1 simplification; Odysseus uses BM25-style scoring plus vector search.
- After #13, inject retrieved memory as a user-role untrusted context message (preferred) or wrapped system block.

## Config Schema

```json
{
  "memory": {
    "embeddings": {
      "enabled": false,
      "backend": "local",
      "modelId": "Xenova/all-MiniLM-L6-v2",
      "providerId": "",
      "blendWeight": 0.5,
      "queryTimeoutMs": 3000,
      "reindexNeeded": false
    }
  }
}
```

### Vector store shape (`~/.minnow/memory/vectors.json`)

```json
{
  "version": 1,
  "model": "Xenova/all-MiniLM-L6-v2",
  "backend": "local",
  "dim": 384,
  "vectors": {
    "entry-id-uuid": [0.1, 0.2, "..."]
  }
}
```

## API Routes

| Method | Path | Body / response |
|--------|------|-----------------|
| GET | `/api/memory/embeddings/status` | `{ enabled, backend, model, dim, vectorCount, reindexNeeded, healthy }` |
| POST | `/api/memory/embeddings/reindex` | `{ ok, indexed, failed, durationMs }` |

Retrieval itself stays on existing memory inject path; hybrid logic runs inside `retrieveMemoryBlockHybrid` called from store/middleware.

## Detailed Implementation Phases

### Phase 1 — Vector math and store (1 day)

1. Create `server/memory/vector-store.js`:
   - `cosineSimilarity(a, b)` — dimension check, zero-vector guard.
   - `loadVectorStore()` / `saveVectorStore()` — atomic write (temp + rename).
   - `upsertEntryVector(entryId, vector)` — validate id via `isValidEntryId`.
   - `deleteEntryVector(entryId)`.
   - `reindexAllMemoryEntries(embedFn)` — iterate all entries, embed `title + "\n" + body`.
   - Model/backend/dim mismatch → set `reindexNeeded: true` in config.
2. Tests: cosine edge cases, dimension mismatch, atomic save, invalid entry id rejected.

### Phase 2 — Embedder interface (1–2 days)

1. **Spike (0.5 day):** Evaluate local embedder options for Node 20+, Windows NSIS, lazy-load size.
2. Create `server/memory/embeddings.js`:
   - `getEmbedder(config)` → `{ id, dim, embed(texts: string[]): Promise<number[][]> }`.
   - **Local backend:** lazy-import chosen library; cache model at module scope; model dir `~/.minnow/models/embeddings/`.
   - **Provider backend:** POST to `embeddingsPath` with provider auth; batch texts.
   - Timeout wrapper: reject after `queryTimeoutMs`.
3. Windows: set `HF_HUB_DISABLE_SYMLINKS=1` (or equivalent) before model download.
4. Extend `server/providers/paths.js` with `embeddingsPath` default `/v1/embeddings`.
5. Tests: mock local embedder, provider fetch mock, timeout → throws.

### Phase 3 — Sync vectors on writes (1 day)

1. In `server/memory/store.js`:
   - After `createEntry()`: embed and `upsertEntryVector` (async, non-blocking for API response optional).
   - After `updateEntry()` when title/body/tags change: re-embed.
   - After `deleteEntry()`: `deleteEntryVector`.
2. On vector write failure: log warning, set `reindexNeeded`, **do not fail** memory save.
3. Tests: CRUD sync, failure does not roll back entry.

### Phase 4 — Hybrid retrieval (1 day)

1. Add `retrieveMemoryBlockHybrid(allEntries, opts, config)` in `retrieve.js`:
   - If embeddings disabled → `retrieveMemoryBlock()` (sync).
   - Embed query once (async).
   - Score each entry: `keywordScore` (existing `scoreEntry`) + `vectorScore` (cosine).
   - Normalize both to 0–1 range before blend: `final = (1-w)*keywordNorm + w*vectorNorm`.
   - On embed failure/timeout → keyword-only fallback.
   - Preserve pinned/recent fallback when no matches.
2. Wrap output with #13 `wrapUntrusted(text, { source: 'memory' })`.
3. Tests: paraphrase fixture (no keyword overlap, high vector match), blend weights, fallback.

### Phase 5 — Settings and reindex UX (1 day)

1. Extend `MemoryConfig` in `src/memory/types.ts`.
2. Add UI in Memory settings section:
   - Toggle: embeddings enabled.
   - Select: backend (local / provider).
   - Input: model id, provider id (when provider backend).
   - Slider: blend weight 0–1.
   - Status: vector count, model, reindex-needed badge.
   - Button: Reindex all (calls POST reindex).
   - Note: first local model use may download files.
3. Mirror defaults in `server/config/home.js` + validators.

### Phase 6 — User-role injection (if not done in #13) (0.5 day)

1. Move wrapped memory block from system `{{memory}}` to user-role message in `buildApiMessages`.
2. Document reduced-assurance interim if deferred.

## Implementation TODOs

- [ ] Extend `DEFAULT_MEMORY_CONFIG` with an `embeddings` object
- [ ] Mirror embeddings defaults in `server/config/home.js` and validation/default merge paths
- [ ] Extend `src/memory/types.ts` for the client config shape
- [ ] Add provider `embeddingsPath` support or document the OpenAI-compatible `/v1/embeddings` default in provider runtime code
- [ ] Add Windows model-cache safeguards equivalent to Odysseus's `HF_HUB_DISABLE_SYMLINKS=1` behavior
- [ ] Add `server/memory/embeddings.js`
- [ ] Add `server/memory/vector-store.js`
- [ ] Hook vector upsert/delete into `createEntry`, `updateEntry`, and `deleteEntry`
- [ ] Add `reindexAllMemoryEntries()` route and settings action
- [ ] Add async hybrid retrieval and keep the sync keyword function for fallback/tests
- [ ] Wrap injected memory with #13 `wrapUntrusted`
- [ ] Add focused memory embedding tests
- [ ] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_embedding_lanes.py` | Simplified — single lane in v1 |
| `tests/test_memory_extractor_vector_degraded.py` | Hybrid fallback when embed unhealthy |
| `tests/test_memory_recall_nondict_rows.py` | Edge cases in retrieve |

## Acceptance Criteria

- Existing memory retrieval works with embeddings disabled.
- Existing entries can be reindexed.
- New, updated, and deleted memory entries keep vectors in sync.
- A paraphrased query with no keyword overlap can retrieve the intended memory entry.
- Changing backend/model invalidates the old vector index and requires or triggers reindexing.
- Retrieved memory is wrapped as untrusted per #13.

## Verification

- Run `npm run test:memory`.
- Add tests for cosine similarity, model mismatch, vector CRUD, and hybrid scoring.
- Add tests for embed timeout falling back to keyword retrieval.
- Manual: save a memory with wording A, ask with wording B, and confirm it appears in the injected memory block.
- Manual: disable embeddings and confirm keyword-only v1 behavior returns.

## Risks And Guardrails

- Local embedding dependencies may affect package size and startup. Lazy-load only.
- Do not add a mandatory cloud dependency.
- Do not inject unwrapped memory after #13 ships.
- Do not claim #13 parity until semantic memory injection either moves to a user-role context message or explicitly ships as reduced-assurance system-prompt fencing.
- Do not store vectors for invalid or unknown entry ids.
