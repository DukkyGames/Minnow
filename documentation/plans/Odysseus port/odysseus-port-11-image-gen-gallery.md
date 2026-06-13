# Odysseus Port 11 — Image Generation And Gallery

Tier: 3  
Effort: M-L  
Priority: Later  
Status: Planned  
Depends on: #12 for provider credentials when needed  
Linear: [MIN-121](https://linear.app/minnowai/issue/MIN-121/odysseus-port-11-image-generation-and-gallery)

## Goal

Add image generation and a persistent local gallery so Minnow can create, browse, and reuse generated assets. The feature should support OpenAI-compatible image APIs first and leave local Stable Diffusion-style backends behind the same interface.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#12** (provider API keys), **#2** optional (local diffusion via Cookbook) |
| npm packages | Optional: `sharp` for thumbnails (evaluate vs browser canvas); SQLite via `better-sqlite3` if chosen |
| Provider | OpenAI-compatible `POST /v1/images/generations` |
| Disk space | User-managed; cap via config under `~/.minnow/gallery/` |
| Estimated effort | 6–9 days (provider + gallery UI); +5 days for local diffusion |

## Prerequisites & Deliverables

| Phase | Deliverable |
|-------|-------------|
| P1 | Provider image generation proxy |
| P2 | Gallery file + metadata store |
| P3 | Gallery MinnowOS app (generate, grid, detail) |
| P4 | Albums + cleanup caps |
| P5 | Optional `generate_image` agent tool |
| P6 | Optional local diffusion via Cookbook (#2) |

## Verified Source Context

- Odysseus references:
  - `src/generated_images.py` — path confinement, filename pattern
  - `routes/gallery_routes.py`, `routes/gallery_helpers.py`
  - `mcp_servers/image_gen_server.py`
  - DB-backed `GalleryAlbum`, `GalleryImage`
- Minnow: vision input exists; no image generation yet.
- Tool definitions: `src/tools/definitions.ts`.
- MinnowOS: add `gallery` to `src/os/types.ts`.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/images/providers.js` | OpenAI-compatible + local client interface |
| `server/images/store.js` | Metadata + file paths |
| `server/images/thumbnails.js` | Optional thumbnail generation |
| `server/images/middleware.js` | `/api/images` routes |
| `src/ui/gallery-page.ts` | Gallery app UI |
| `src/styles/gallery.css` | Styles |
| `test/images/generate.test.mjs` | Mock provider responses |
| `test/images/store.test.mjs` | Metadata CRUD, cleanup |
| `test/images/path-confinement.test.mjs` | Traversal rejection |

## Files to Modify

| Path | Change |
|------|--------|
| `src/os/types.ts` | Add `'gallery'` to `AppId` |
| `src/os/app-registry.ts` | Register Gallery |
| `src/os/app-host.ts` | Gallery layer |
| `index.html` | `#galleryView` |
| `server/config/home.js` | `images` config block |
| `server/providers/paths.js` | Optional `imagesPath` default `/v1/images/generations` |
| `server/runtime/middlewares.js` | Register images middleware |
| `src/tools/definitions.ts` | `generate_image` tool (P5) |
| `documentation/context.md` | Document gallery |

## Storage decision

| Option | Pros | Cons |
|--------|------|------|
| **JSON index** (`index.json`) | No new dependency | Poor query at scale |
| **SQLite** (`gallery.db`) | Odysseus parity, album queries | Adds `better-sqlite3` |

Recommend **JSON index for v1** with documented SQLite migration path if album count exceeds ~500 images.

## Config Schema

```json
{
  "images": {
    "defaultProviderId": "openai-cloud",
    "defaultModel": "dall-e-3",
    "defaultSize": "1024x1024",
    "defaultCount": 1,
    "maxFileBytes": 10485760,
    "maxGalleryBytes": 1073741824,
    "maxImages": 500
  }
}
```

## Data Model

```ts
interface GalleryAlbum {
  id: string;
  name: string;
  createdAt: string;
}

interface GalleryImage {
  id: string;
  albumId: string;
  prompt: string;
  negativePrompt?: string;
  providerId?: string;
  model?: string;
  params: Record<string, unknown>;
  filePath: string;       // relative to ~/.minnow/gallery/images/
  thumbnailPath?: string;
  width?: number;
  height?: number;
  createdAt: string;
  provenance: 'generated' | 'imported';
}
```

Files: `~/.minnow/gallery/images/<id>.png`, index at `~/.minnow/gallery/index.json`.

## API Routes

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/images/generate` | `{ prompt, negativePrompt?, providerId?, model?, size?, count?, albumId? }` |
| GET | `/api/images` | `?albumId=&limit=&offset=` |
| GET | `/api/images/:id` | Metadata |
| GET | `/api/images/:id/file` | Image bytes — path confinement required |
| GET | `/api/images/:id/thumbnail` | Thumbnail bytes |
| DELETE | `/api/images/:id` | Remove file + metadata |
| GET | `/api/images/albums` | List albums |
| POST | `/api/images/albums` | Create album |
| POST | `/api/images/cleanup` | Enforce caps (admin/settings action) |

## Detailed Implementation Phases

### Phase 1 — Provider proxy (2 days)

1. `server/images/providers.js`:
   - `generateImage({ providerId, model, prompt, size, count, ... })`.
   - POST to `{baseUrl}/v1/images/generations` (or `imagesPath` from provider config).
   - Auth via #12 + `auth-headers.js`.
   - Handle response formats: `url` (download) or `b64_json` (decode).
   - Structured errors: rate limit, content policy, invalid size.
2. Extend provider capability metadata for image endpoints.
3. Tests: mock fetch with `b64_json` fixture PNG.

### Phase 2 — Gallery store (1.5 days)

1. `server/images/store.js`:
   - Save bytes to `~/.minnow/gallery/images/<uuid>.png` atomically.
   - Append metadata to `index.json` (or SQLite row).
   - `deleteImage(id)` — remove file + index entry.
   - `enforceCaps()` — delete oldest when over `maxGalleryBytes` or `maxImages`.
   - Path confinement on serve: `resolve` + `commonpath` check (port Odysseus `test_generated_image_confinement`).
2. Default album: "Generated".
3. Tests: CRUD, cap enforcement, traversal rejection (`../../../etc/passwd`).

### Phase 3 — Gallery app UI (3 days)

1. Add `gallery` MinnowOS app.
2. `src/ui/gallery-page.ts`:
   - **Generate form:** prompt, negative prompt (if supported), size, model picker, album select.
   - Progress state during generation (non-blocking UI).
   - **Grid view:** thumbnails grouped by album filter.
   - **Detail view:** full image, prompt, params, provenance, created date.
   - Actions: copy prompt, download, open in system viewer, delete.
   - Reload persistence across app restart.
3. `thumbnails.js` (optional): generate 256px thumb on save via `sharp` or skip and use CSS scaling in v1.

### Phase 4 — Albums and cleanup (1 day)

1. Album CRUD in store + UI filter tabs.
2. Settings or gallery admin: show disk usage, run cleanup, configure caps.
3. Tests: album assignment, cleanup deletes oldest first.

### Phase 5 — Agent tool (1 day)

1. `generate_image` in `definitions.ts`:
   - `serverRequired: true`.
   - Args: `prompt`, `album?`, `size?`, `providerId?`, `model?`.
   - Permission-gated — respect tool permissions config.
   - Returns: `{ imageIds: string[], attachments: [...] }` with gallery links.
   - Port behavior from Odysseus `mcp_servers/image_gen_server.py`.
2. Does not bypass user tool approval when configured.

### Phase 6 — Local diffusion (deferred)

1. Cross-link to #2 Cookbook for local image model fit/download/serve.
2. `providers.js` local backend: POST to served diffusion endpoint.
3. Defer inpaint/upscale/style-transfer unless Gallery explicitly expanded.

**Video assets:** Odysseus gallery supports video; **out of v1 scope** unless explicitly promoted.

## Implementation TODOs

- [ ] Add image config block for provider/model/default params
- [ ] Decide SQLite vs JSON metadata store before implementation
- [ ] Add server image generation proxy
- [ ] Add gallery file and metadata store
- [ ] Add Gallery app shell and grid UI
- [ ] Add album support
- [ ] Add image detail view and download/open actions
- [ ] Add optional `generate_image` tool
- [ ] Add optional local Stable Diffusion/Cookbook integration phase
- [ ] Decide whether video assets are in v1 scope; Odysseus gallery supports more than still images
- [ ] Add cleanup/cap settings
- [ ] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_generated_image_confinement.py` | path-confinement |
| `tests/test_gallery_*.py` (11 files) | store, API |
| `tests/test_admin_wipe_gallery.py` | cleanup |

## Acceptance Criteria

- A configured endpoint can generate an image from a prompt.
- Generated image bytes and metadata are saved locally.
- Gallery grid persists across reload.
- Albums group images.
- Optional tool returns saved gallery ids without bypassing permissions.
- Path traversal on asset routes is rejected.

## Verification

- Add route tests with mocked image provider responses
- Add gallery store tests for metadata, file paths, and deletion/cleanup
- Add path traversal tests for gallery asset serving
- Add UI source-contract tests for Gallery app registration and markup
- Manual: generate an image, reload, and confirm it appears with metadata
- Manual: verify large/failed provider responses show clear errors

## Risks And Guardrails

- Provider credentials depend on #12.
- Image files can consume disk quickly; add caps and cleanup.
- Preserve provenance metadata.
- Do not block the UI while generation runs.
- Local diffusion and advanced editing can exceed this plan's M-L scope; keep them optional unless explicitly promoted.
- Do not add heavy image-processing dependencies unless basic browser APIs are insufficient.
