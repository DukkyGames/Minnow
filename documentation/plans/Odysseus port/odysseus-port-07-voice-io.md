# Odysseus Port 07 — Voice I/O

Tier: 2  
Effort: M-L  
Priority: Medium  
Status: Shipped (MIN-123)  
Depends on: #12 for provider credentials  
Linear: [MIN-123](https://linear.app/minnowai/issue/MIN-123/odysseus-port-07-voice-io)

## Goal

Add speech-to-text dictation for the composer and text-to-speech playback for assistant messages. Provider-backed STT/TTS should ship first; bundled local Whisper can be a later backend.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#12** for provider API keys (provider-backed path) |
| npm packages | None for provider proxy; optional later: `faster-whisper` bindings |
| Browser APIs | `MediaRecorder`, `Audio` playback, `speechSynthesis` (Phase 0 fallback) |
| Provider | OpenAI-compatible `/audio/transcriptions` and `/audio/speech` endpoints |
| Estimated effort | 5–7 days (provider path); +5 days for local Whisper phase |

## Prerequisites & Deliverables

| Deliverable | Description |
|-------------|-------------|
| `server/stt/` + `server/tts/` | Provider proxy routes |
| Composer mic button | `MediaRecorder` → transcribe → insert text |
| Assistant play button | TTS → audio playback on click |
| Voice settings section | Provider, model, voice, speed |
| Upload limits | Port Odysseus byte/duration caps |
| Optional Phase 0 | Browser Web Speech API fallback (no #12 needed) |

## Verified Source Context

- Odysseus references:
  - `services/stt/stt_service.py`, `routes/stt_routes.py` — `POST /api/stt/transcribe`
  - `services/tts/tts_service.py`, `routes/tts_routes.py` — `POST /api/tts/synthesize`
  - `static/js/tts-ai.js` — browser fallback providers
  - Upload limits in `src/upload_limits.py`
- Minnow composer: `src/ui/composer-surface.ts` → `getActiveComposerSurface().inputEl`.
- Assistant messages: `src/ui/messages.ts`.
- Provider proxy patterns: `server/providers/store.js`, `server/providers/auth-headers.js`.
- Settings: `src/ui/settings-page-types.ts`, `src/ui/settings-sections.ts`, `index.html`.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/stt/middleware.js` | `POST /api/stt/transcribe` |
| `server/stt/limits.js` | Max bytes, duration, MIME allowlist |
| `server/tts/middleware.js` | `POST /api/tts/synthesize` |
| `server/tts/cache.js` | Optional short-lived audio cache under `~/.minnow/tts-cache/` |
| `src/ui/voice-controls.ts` | Mic + play button helpers |
| `src/ui/settings-voice.ts` | Voice settings panel |
| `test/stt/transcribe.test.mjs` | Mock provider, size rejection |
| `test/tts/synthesize.test.mjs` | Mock provider, cache |

## Files to Modify

| Path | Change |
|------|--------|
| `src/ui/messages.ts` | Play button on completed assistant messages |
| `src/ui/composer-surface.ts` or input toolbar | Mic button |
| `server/config/home.js` | `voice` config block defaults |
| `server/config/validators.js` | Validate voice config |
| `server/runtime/middlewares.js` | Register STT/TTS middleware |
| `src/ui/settings-page-types.ts` | Add `'voice'` section (or under `model-routing`) |
| `src/ui/settings-sections.ts` | Wire voice settings |
| `index.html` | Voice settings markup |
| `documentation/context.md` | Document voice providers and limits |

## Config Schema

```json
{
  "voice": {
    "stt": {
      "enabled": true,
      "providerId": "openai-cloud",
      "model": "whisper-1",
      "language": "en"
    },
    "tts": {
      "enabled": true,
      "providerId": "openai-cloud",
      "model": "tts-1",
      "voice": "alloy",
      "speed": 1.0,
      "format": "mp3"
    },
    "limits": {
      "maxAudioBytes": 26214400,
      "maxDurationSeconds": 300
    }
  }
}
```

## API Routes

| Method | Path | Request | Response |
|--------|------|---------|----------|
| POST | `/api/stt/transcribe` | `multipart/form-data` — `file` (audio), optional `language` | `{ text: string }` |
| GET | `/api/stt/status` | — | `{ enabled, providerId, model, healthy }` |
| POST | `/api/tts/synthesize` | `{ text, voice?, speed?, format? }` | `audio/mpeg` bytes or `{ url: '/api/tts/audio/:id' }` |
| GET | `/api/tts/audio/:id` | — | Cached audio bytes (short TTL) |
| GET | `/api/tts/status` | — | `{ enabled, providerId, model, voice }` |

Server proxies to provider:
- STT: `POST {baseUrl}/v1/audio/transcriptions` (multipart forward).
- TTS: `POST {baseUrl}/v1/audio/speech` (JSON forward).

Auth via `auth-headers.js` + #12 secrets.

## Detailed Implementation Phases

### Phase 0 — Browser fallback decision (0.5 day)

Decide and document:

| Option | Pros | Cons |
|--------|------|------|
| **Defer browser STT/TTS** | Simpler v1 | No voice without provider |
| **Ship browser TTS only** | Works offline, no #12 | Quality varies by OS |
| **Ship browser STT via Web Speech API** | No provider for dictation | Electron/Chromium only; quality varies |

Recommendation: ship **provider-backed v1**; add browser TTS as optional fallback in settings (`tts.provider: browser`).

### Phase 1 — TTS (2 days)

1. `server/tts/middleware.js`:
   - Validate text length (max 4096 chars).
   - Load provider runtime + auth.
   - POST to provider speech endpoint.
   - Return audio bytes with correct `Content-Type`.
   - Optional: cache by hash(text+voice+speed) in `tts/cache.js`.
2. `src/ui/messages.ts`:
   - Add play button (▶) on completed assistant text messages.
   - On click: POST synthesize → `new Audio(blobUrl)` → play.
   - Loading spinner on button; error toast on failure.
   - **Never autoplay.**
3. `src/ui/settings-voice.ts`:
   - TTS provider picker, model, voice select, speed slider.
   - Test voice button with fixed phrase "Hello from Minnow."
4. Tests: mock fetch returns fake MP3 bytes.

### Phase 2 — STT (2 days)

1. `server/stt/limits.js` — port Odysseus caps:
   - Max file size: 25 MB default.
   - Allowed MIME: `audio/webm`, `audio/wav`, `audio/mp4`, `audio/mpeg`.
   - Reject unknown types before proxying.
2. `server/stt/middleware.js`:
   - Parse multipart upload (use existing server multipart pattern or `busboy`).
   - Forward to provider transcriptions endpoint.
   - Return `{ text }`.
3. Composer mic UX:
   - Mic button in composer toolbar (all surfaces via `composer-surface.ts`).
   - Click → request `navigator.mediaDevices.getUserMedia({ audio: true })`.
   - `MediaRecorder` → `audio/webm` blob on stop.
   - POST to `/api/stt/transcribe`.
   - Insert transcript at cursor in `inputEl` (or append).
   - Visual: recording indicator, stop button, permission denied message.
4. Tests: oversize rejection, unsupported MIME.

### Phase 3 — Settings integration (0.5 day)

1. Add `'voice'` to settings nav (under Models & APIs or new Integrations group).
2. STT + TTS sub-panels with enable toggles.
3. Link from error states: "Configure Voice in Settings."

### Phase 4 — Local Whisper (deferred, +5 days)

1. Evaluate: `whisper.cpp` subprocess, `faster-whisper` Node binding, or transformers.js.
2. Same `POST /api/stt/transcribe` interface; `stt.providerId: "local"`.
3. Model cache under `~/.minnow/models/whisper/`.
4. Document GPU/CPU requirements.

## Implementation TODOs

- [x] Add `voice` config block to `config.json` metadata
- [x] Add browser Web Speech API fallback as Phase 0 or explicitly document why it is deferred
- [x] Add `server/tts/` proxy route
- [x] Add assistant message play button and audio playback
- [x] Add TTS settings UI
- [x] Add `server/stt/` transcription route
- [x] Port audio upload byte/duration limits from Odysseus
- [x] Add mic permission/capture UX using `MediaRecorder`
- [x] Insert transcript into `getActiveComposerSurface().inputEl`
- [x] Add optional local Whisper backend design notes after provider path works
- [x] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_stt_leak.py` | No audio/transcript in logs |
| `tests/test_tts_speed_malformed.py` | Speed validation |
| `tests/test_speech_service_toggles.py` | Enable/disable behavior |

## Acceptance Criteria

- Clicking play reads an assistant message aloud with configured TTS.
- Clicking mic records speech and inserts a transcript into the active composer.
- Voice settings persist and survive reload.
- No recording starts without explicit user action.
- Missing provider/mic states produce clear UI messages.

## Verification

- Add source-contract tests for message play-button rendering
- Add route tests with mocked provider fetch for TTS/STT
- Add tests for upload size rejection and unsupported audio MIME types
- Manual: configure a test TTS provider and play an assistant message
- Manual: dictate a short sentence and confirm it appears in the composer
- Run `npx tsc --noEmit` after touching shared UI/provider types

## Risks And Guardrails

- Microphone permission UX must be explicit and reversible.
- Audio payloads can be large; cap size and duration.
- Provider keys depend on #12.
- Browser fallback can ship before #12, but provider-backed STT/TTS cannot.
- Do not autoplay assistant messages.
- Treat transcripts as user input, not trusted commands.
