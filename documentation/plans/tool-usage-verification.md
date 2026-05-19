# SA-16 — Tool + attachment E2E verification

**Date:** 2026-05-19  
**Environment:** Windows, Node 22, SpeedChat on `http://localhost:5176/` (`npm start` — ports 5173–5175 were in use)  
**Build:** `npm run build` — **PASS** (tsc + vite)  
**Automated smoke:** `npx tsx scripts/sa16-smoke.mjs http://localhost:5176` — **PASS** (all API/browser-unit checks green)

Manual and smoke checks for the tool loop, multimodal send path, and composer attachments. See [`to-fix.md`](to-fix.md) for open backlog items. Project context: [`documentation/context.md`](../context.md).

## Bug fixes during verification (minimal)

| Fix | File | Reason |
|-----|------|--------|
| Guard `document` in drawer helpers | `src/tools/config.ts` | `setLocalServerAvailable()` called `refreshServerToolDisabledState()` which threw in Node/tests when `document` is undefined |

---

## Tools checklist

| # | Check | Result | Notes |
|---|--------|--------|-------|
| T1 | `npm start` serves app + tools API | **PASS** | `node server.js` → Vite on 5176; app HTML loads |
| T2 | `GET /api/tools/ping` → `{ ok: true }` | **PASS** | Smoke + PowerShell `Invoke-RestMethod` |
| T3 | Enable `get_datetime` / `calculate` (defaults on) | **PASS** | Settings drawer: Date & time + Calculate checked (`readonly` when server tools dimmed is expected) |
| T4 | Enable `read_file` / `git_status` (server tools) | **PASS** | Rows present; server online — tools executable via API when enabled in config |
| T5 | `get_datetime` execution path | **PASS** | `executeBrowserTool('get_datetime')` → ISO 8601 string (smoke) |
| T6 | `calculate` execution path | **PASS** | `executeBrowserTool('calculate', { expression: '2+2' })` → `4` (smoke) |
| T7 | `read_file` server tool | **PASS** | POST returned `package.json` body (smoke) |
| T8 | `git_status` server tool | **PASS** | POST returned porcelain status (smoke) |
| T9 | Tool bubbles in UI during chat | **PENDING** | Requires manual run with `npm start` + LM Studio + tool-capable model — see [Manual QA — T9](#manual-qa--t9-live-tool-bubbles) |
| T10 | Tool config reload persistence | **PASS** | `speedchat.tools` in `localStorage` via `saveToolConfig` / `loadToolConfig` (code review + drawer sync on load) |
| T11 | Server killed → server tools error | **PASS** | `executeTool('read_file')` with `localServerAvailable=false` → `Error: local tool server is not available…` (smoke) |

---

## Attachments checklist

| # | Check | Result | Notes |
|---|--------|--------|-------|
| A1 | Paperclip / `#attachBtn` in input bar | **PASS** | Browser snapshot: “Attach files” control + hidden `#fileInput` |
| A2 | `.ts` file included in message context | **PASS** | `buildHistoryUserContent` emits `<file name="foo.ts">…</file>` (smoke); `processFile` routes `.ts` as text (browser uses FileReader) |
| A3 | Image + VLM multimodal API payload | **PENDING** | `buildVlmUserApiContent` adds `image_url` parts when `modelCache` type is `vlm` (code review); live VLM not exercised — see [Manual QA — A3](#manual-qa--a3-image--vlm-multimodal) |
| A4 | PDF via server `read_document` | **PENDING** | POST pipeline smoke-tested; valid PDF attach needs manual run — see [Manual QA — A4](#manual-qa--a4-valid-pdf-attach) |
| A5 | Remove attachment chip | **PASS** | `removeAttachment` + `renderAttachPreview` in `store.ts` (code review); chip remove button bound in `createAttachChip` |
| A6 | Clear attachments after successful send only | **PASS** | **Intentional:** `clearAttachments()` in `sendMessageWithTools` `finally` only when `completedNormally` (`loop.ts`). Abort, errors, and max tool turns **retain** `#attachPreview` chips for retry |
| A7 | History placeholder for images | **PASS** | `[image: a.jpg]` from `buildHistoryUserContent` (smoke) |
| A8 | 15 MB file blocked | **PASS** | Limit is **10 MB** (`MAX_ATTACHMENT_BYTES`); 16 MB test file → error chip “exceeds 10MB limit” (smoke). Files ≥10 MB including 15 MB are rejected |

### Open manual IDs (quick reference)

| ID | Area | Check |
|----|------|--------|
| T9 | Tool bubbles | Live tool UI: collapsed name + Success/Failed; expand for args/result |
| A3 | VLM multimodal | Image + VLM model returns a reply |
| A4 | PDF | Valid PDF attach with `pdf-parse` installed and `npm start` |

---

## Summary

| Area | Pass | Fail | Pending (manual) |
|------|------|------|------------------|
| Tools | 10 | 0 | 1 (T9) |
| Attachments | 6 | 0 | 2 (A3, A4) |
| Build / smoke automation | 2 | 0 | 0 |

**Overall:** Core server, browser tool routing, attachment serialization, size limits, and clear-on-success attachment policy are verified. Live tool bubbles (T9), VLM image send (A3), and valid PDF attach (A4) need LM Studio / optional `pdf-parse` and the manual steps below.

**Re-run smoke:** `npm start` then `npx tsx scripts/sa16-smoke.mjs http://localhost:<port>`

---

## Manual QA — T9 (live tool bubbles)

**Prerequisites:** LM Studio running with a **tool-capable** model loaded; SpeedChat via **`npm start`** (not `npm run dev` alone); in Settings → Tools enable at least `get_datetime` and/or `calculate` (defaults).

1. Open the app URL from the terminal (e.g. `http://localhost:5173/`).
2. Confirm Settings → Tools: server tools are not dimmed (ping OK).
3. Select the tool-capable model in the header dropdown.
4. Send a prompt that triggers a tool, e.g. *“What is the current date and time?”* or *“Calculate 17 × 23.”*
5. **Pass:** During the reply (before reload), the transcript shows tool row(s): collapsed **tool name** + **Success** or **Failed**; click expands **Arguments** and **Result**.
6. **Pass:** After reload or switching chats and back, the same tool rows render from history (no spinner).
7. **Fail:** Only a plain assistant bubble (“Calling tools…”) with no tool rows until reload — see [`to-fix.md`](to-fix.md) item 1 (live wiring).

---

## Manual QA — A3 (image + VLM multimodal)

**Prerequisites:** LM Studio with a **VLM** model loaded (`type: vlm` in model list); **`npm start`**.

1. Select the VLM model in the header.
2. Paperclip → attach a small **`.jpg`** or **`.png`** (&lt; 10 MB).
3. Confirm a preview chip appears in `#attachPreview`.
4. Send a short question about the image (e.g. *“What is in this image?”*).
5. **Pass:** Reply completes; attachment chips **clear** from the composer on successful send.
6. **Pass (optional):** In LM Studio / network tab, request user `content` includes `image_url` parts (not only a text placeholder).
7. User message in history shows `[image: filename.jpg]` placeholder (by design).

---

## Manual QA — A4 (valid PDF attach)

**Prerequisites:** **`npm start`**; optional dependency installed: `npm install` (pulls `pdf-parse` if available).

1. Attach a **valid** PDF (&lt; 10 MB) via the paperclip.
2. **Pass:** Preview chip shows extracted text or a success state (not “PDF requires the local tool server”).
3. Send a message referencing the PDF content.
4. **Pass:** Assistant can use the extracted text; chips clear after **successful** send only.
5. **Fail / hint:** Install message in chip or tool result → run `npm install pdf-parse` and restart `npm start`.
