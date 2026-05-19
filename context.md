# SpeedChat — project context

## What it is

Single-page web app (`index.html`) for chatting with LM Studio via `POST /api/v0/chat/completions` on the configured server URL (default `http://localhost:1234`). Includes streaming responses, token stats, model picker, and a PWA manifest/service worker.

## Settings UI

The settings drawer slides in from the right below the top bar. Its width is capped with `min(420px, calc(100vw - 16px))` so it uses more horizontal space on wide screens while staying usable on narrow ones. The system prompt field uses a taller textarea (`rows="12"`, min-height ~200px, max-height tied to viewport) with vertical resize.

## System prompt

The settings drawer contains a **System Prompt** textarea. Each request prepends a `system` message from that field when non-empty. **Presets**: a dropdown loads built-in instruction templates; choosing **Custom** keeps free-form text. Edited preset text switches the UI to Custom. Switching to another preset while the textarea no longer matches the committed template shows a confirm dialog. The selected preset id (when the text still matches that template) and the textarea value are saved in `localStorage` under `speedchat.systemPrompt`.

## Key files

- `index.html` — UI, client logic, LM Studio API calls
- `sw.js` — service worker
- `manifest.json` — PWA metadata
- `documentation/` — design and feature plans
