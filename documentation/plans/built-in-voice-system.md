# Built-in Voice System

Implementation plan for local Whisper STT + Qwen3-TTS. Full schema and phased delivery: see the Cursor plan `built-in_voice_system_1491dd82`.

## Phase 1 (shipped)

- Extended `voice` config: `audio`, nested `stt` (`local` | `provider`), nested `tts` (`local` | `provider` | `browser`)
- GPU-first defaults via `server/voice/config.js` + `detectHardware()`
- Settings → **Audio** (`src/ui/settings-audio.ts`)
- Models → **Voice** tab shell (`src/ui/models/voice-panel.ts`)
- Catalog stubs: `src/voice/catalog-stt.ts`, `src/voice/catalog-tts.ts`
- Legacy `#/settings/voice` → `#/app/models/voice`

## Phase 2 (shipped)

- **Provisioner** (`server/voice/provision.js`) — reuses shared `python-build-standalone` from `~/.minnow/servers/python`, venv at `~/.minnow/voice/venv`, pip installs `torch` (CPU wheels), `transformers`, `accelerate`, `soundfile`, optional `qwen-tts`; meta at `~/.minnow/voice/meta.json`
- **Worker skeleton** (`server/voice/python/worker.py`) — stdlib HTTP server: `GET /health`, `GET /voice/capabilities`, stub `POST` routes return 501
- **Runtime manager** (`server/voice/runtime-manager.js`) — `installRuntime`, `repairRuntime`, `startWorker`, `stopWorker`, `getHealth`, `getRuntimeStatus`
- **APIs** (`server/voice/routes.js`, wired in `server/runtime/middlewares.js`):
  - `GET /api/voice/runtime/status`
  - `POST /api/voice/runtime/install` + `GET /api/voice/runtime/install/stream` (SSE)
  - `POST /api/voice/runtime/repair`, `/start`, `/stop`
- **Client** (`src/voice/api-client.ts`) — `fetchRuntimeStatus`, `installRuntime`, `subscribeInstallProgress`, worker start/stop
- **UI** — Models → Voice runtime card: install/repair/start/stop buttons + health badge
- **Tests** — `test/voice/runtime.test.mjs`

## Phase 3 (shipped)

- **Downloads** ([`server/voice/download.js`](../server/voice/download.js)) — HF snapshot downloads to `~/.minnow/models/voice/` via [`downloadHfSnapshot`](../server/models/hf-client.js); manifest `~/.minnow/voice/installed.json`; job index `~/.minnow/voice/downloads.json`
- **APIs** (extended [`server/voice/routes.js`](../server/voice/routes.js)):
  - `POST /api/voice/download` `{ modelId, kind: 'stt' | 'tts' }` (TTS returns 400 until Phase 4)
  - `GET /api/voice/download/:id/stream` SSE progress
  - `POST /api/voice/download/:id/cancel`
  - `GET /api/voice/models/installed`
  - `DELETE /api/voice/models/:kind/:modelId`
- **Local STT** ([`server/voice/local-stt.js`](../server/voice/local-stt.js)) — Node middleware → worker HTTP; [`server/stt/middleware.js`](../server/stt/middleware.js) routes `voice.stt.backend === 'local'` to `transcribeLocal`; status adds `backend`, `modelId`, `runtimeReady`, `modelLoaded`, `cudaAvailable`, `warning`
- **Worker** ([`server/voice/python/worker.py`](../server/voice/python/worker.py)) — `POST /stt/transcribe`, `POST /models/load`, `POST /models/unload`, `GET /voice/capabilities` (`cuda`, `flashAttnAvailable`)
- **Client** — [`src/voice/api-client.ts`](../src/voice/api-client.ts) download helpers; [`src/voice/settings-form.ts`](../src/voice/settings-form.ts) capability-gated STT form; [`src/voice/voice-fit.ts`](../src/voice/voice-fit.ts) fit badges; Models → Voice STT tab ([`src/ui/models/voice-panel.ts`](../src/ui/models/voice-panel.ts)) catalog + downloads + installed list + settings + 5s mic test
- **Tests** — `test/voice/download.test.mjs`, `test/voice/local-stt.test.mjs`

## Phase 4 (shipped)

- **TTS downloads** ([`server/voice/download.js`](../server/voice/download.js)) — `kind: 'tts'` Qwen HF snapshots + auto-install `Qwen/Qwen3-TTS-Tokenizer-12Hz` when required; manifest rows include `kind`, `mode`
- **Local TTS** ([`server/voice/local-tts.js`](../server/voice/local-tts.js)) — Node middleware → worker; [`server/tts/middleware.js`](../server/tts/middleware.js) routes `voice.tts.backend === 'local'` to `synthesizeLocal`; status adds `backend`, `modelId`, `mode`, `runtimeReady`, `modelLoaded`, `warning`
- **Ref audio** — `POST /api/voice/refs/upload`, `GET /api/voice/clone-prompts`; artifacts under `~/.minnow/voice/refs/` and `clone-prompts/`
- **Worker** ([`server/voice/python/worker.py`](../server/voice/python/worker.py)) — `POST /tts/synthesize` (custom_voice / voice_design / voice_clone), `POST /models/load` `{ kind: 'tts' }`, capabilities expose `speakers` / `languages` when loaded
- **Client** — [`src/voice/settings-form.ts`](../src/voice/settings-form.ts) mode-gated TTS form; [`src/ui/models/voice-panel.ts`](../src/ui/models/voice-panel.ts) TTS catalog + downloads + settings + test voice; [`src/ui/voice-controls.ts`](../src/ui/voice-controls.ts) respects `tts.backend` + `setSinkId`; [`src/ui/composer-voice.ts`](../src/ui/composer-voice.ts) uses `voice.audio.inputDeviceId`
- **Tests** — `test/voice/local-tts.test.mjs`, `test/voice/download.test.mjs` (TTS), `test/tts/synthesize.test.mjs`

## Phase 5 (shipped)

- **Migration** — `openSettings('voice')` / `#/settings/voice` → **Models → Voice** (`openModels('voice')`); deprecated Settings voice panel removed (redirect stub in `index.html`); settings search voice keywords open Models app ([`src/ui/settings-search-index.ts`](../src/ui/settings-search-index.ts))
- **Backwards compat** — `loadVoiceConfig()` + `normalizeVoiceConfig(..., { installedManifest })` keeps `provider` backend when `providerId` is set but no local models are installed
- **Tests** — `test/voice/*.test.mjs` in `npm test`; `test/voice/refs.test.mjs`; tokenizer auto-install assertion in `test/voice/download.test.mjs`
- **Docs** — [`documentation/context.md`](../context.md) Built-in Voice architecture section

## Status

All five phases shipped. See [`documentation/context.md`](../context.md) for runtime architecture, paths, APIs, and GPU/CPU guidance.
