# Step 10 — Bottom terminal panel (implementation build plan)

| Field | Value |
|-------|--------|
| **Step ID** | 10 |
| **Title** | Bottom terminal panel |
| **Backlog** | [`documentation/plans/to-fix.md`](../to-fix.md) item 1 |
| **Roadmap** | [`documentation/plans/to-fix-step-order.md`](../to-fix-step-order.md) — Wave 4 |
| **Depends on** | **Step 02** (`~/.minnow` data layer, session persistence, log paths) |
| **Can parallel with** | Step 11 (file tree) after Step 02 |
| **Out of scope** | Interactive PTY/shell REPL, remote SSH, Step 20 settings UI (terminal toggle only stubbed here) |

---

## Goal

Give users a **dockable bottom panel** below the chat to **watch commands run by the AI** (and optionally run commands manually), with **live stdout/stderr streaming** from `server.js`, reusing the existing **`execute_command`** tool (and related code runners). **Command history is scoped per chat session** and survives reload when Step 02 session storage is in place.

---

## Current state (baseline)

| Area | Today |
|------|--------|
| **UI layout** | `.main-column` = `chat-area` + `input-bar` + `stats-strip` ([`index.html`](../../../index.html), [`src/styles/sidebar.css`](../../../src/styles/sidebar.css)) — **no terminal region** |
| **`execute_command`** | Blocking: [`toolExecuteCommand`](../../../server.js) → [`runProcess`](../../../server.js) buffers all stdout/stderr, returns one string via `POST /api/tools` |
| **Client tool path** | [`executeTool`](../../../src/tools/client.ts) → `fetch('/api/tools')` — no streaming |
| **Tool loop** | [`sendMessageWithTools`](../../../src/tools/loop.ts) awaits `executeTool`, then [`renderToolResult`](../../../src/ui/tool-messages.ts) with final string only |
| **Sessions** | `Chat` has `history` only ([`src/types.ts`](../../../src/types.ts)); persistence in `localStorage` until Step 02 |
| **Tests** | [`scripts/sa16-smoke.mjs`](../../scripts/sa16-smoke.mjs) — ping + tools; **no terminal/stream tests** |

---

## Prerequisites (Step 02 — must be done first)

Implementer **must not** start Step 10 until Step 02 delivers:

1. **Home directory** — `~/.minnow/` (Windows: `%USERPROFILE%\.minnow\`).
2. **Sessions API** — read/write chat blobs under `~/.minnow/sessions/` (or equivalent), not only `localStorage`.
3. **Log directory** — `~/.minnow/logs/terminal/` for full run transcripts (append-only files per `runId`).
4. **`config.json`** — includes UI prefs such as `terminal: { defaultOpen: false, heightPx: 240 }` (exact keys up to Step 02 schema).

**Interim fallback (if Step 02 is partial):** store `terminalHistory` on the in-memory `Chat` object and mirror to `minnow-sessions-v1` in `localStorage` until server session API exists. **Do not** block streaming on Step 02; only block **durable log files** and **cross-device history**.

---

## Design decisions

### Transport: SSE (recommended) vs WebSocket

| Option | Use when |
|--------|----------|
| **SSE** (recommended v1) | One-way server → browser chunks; matches existing [`parseSsePayloads`](../../../src/api/chat.ts) patterns; easy to test with `fetch` + line parser |
| **WebSocket** | Deferred — only if v2 needs bidirectional PTY bytes or cancel without a second HTTP call |

**v1 choice:** **SSE** on `GET /api/terminal/stream/:runId` after `POST /api/terminal/run` allocates a run. Keep `POST /api/tools` for non-streaming callers; `execute_command` uses the streaming path when the terminal feature is active.

### What streams

| Source | Streams to panel? |
|--------|-------------------|
| AI `execute_command` | **Yes** (primary) |
| AI `run_javascript` / `run_python` | **Yes** (same runner; label as `node -e` / `python -c` in UI) |
| User “Run” in terminal input | **Yes** |
| Git/file tools | **No** (still tool bubbles only) |

### Security (unchanged principles)

- Commands run with **`cwd: PROJECT_ROOT`** unless Step 02 adds configurable workspace root (then use that).
- Reuse **`COMMAND_TIMEOUT_MS` (30s)** from [`server.js`](../../../server.js).
- **No shell injection from UI** beyond what `execute_command` already allows — validate `command` is non-empty string; optional blocklist later (Step 20).
- Terminal routes are **local dev only** (`npm start`); same CORS as `/api/tools`.
- Cap in-memory buffer per run (e.g. **2 MB**) before truncating with `…[truncated]` in UI and log file.

---

## Architecture

```mermaid
sequenceDiagram
  participant UI as Terminal panel
  participant Loop as tools/loop.ts
  participant Client as tools/client.ts
  participant API as server.js
  participant Proc as child_process

  Loop->>Client: executeTool(execute_command)
  Client->>API: POST /api/terminal/run
  API->>Proc: spawn (shell)
  API-->>Client: { runId }
  Client->>API: GET /api/terminal/stream/runId (SSE)
  API-->>UI: stdout/stderr events
  Proc-->>API: exit
  API-->>Client: event exit + summary
  Client-->>Loop: final result string
  Loop->>UI: renderToolResult + history append
```

```text
.main-column
├── .chat-area          (flex 1, scroll)
├── .terminal-panel     (NEW — collapsible, resizable height)
├── .input-bar
└── .stats-strip
```

---

## Server (`server.js`)

### New module: `server/terminal-runner.js` (or inline section)

Extract from existing [`runProcess`](../../../server.js):

| Function | Responsibility |
|----------|----------------|
| `createRun({ command, cwd, shell, source, chatId, toolCallId })` | Allocate `runId`, register in `Map`, spawn child |
| `attachStreamHandlers(child, runId)` | On `data` → push SSE + append log file |
| `finishRun(runId, code)` | Emit exit event, delete from active map after grace period |
| `getRun(runId)` | For stream subscription |

**Active runs registry:** `Map<runId, RunState>` with `{ child, listeners, buffer, logPath, meta }`.

### HTTP routes (extend `createToolsMiddleware` or sibling middleware)

| Method | Path | Body / params | Response |
|--------|------|---------------|----------|
| `POST` | `/api/terminal/run` | `{ command, chatId?, cwd?, source?: 'user' \| 'agent', toolCallId? }` | `{ runId, startedAt }` |
| `GET` | `/api/terminal/stream/:runId` | — | **`text/event-stream`** until run completes |
| `POST` | `/api/terminal/cancel/:runId` | — | `{ ok: true }` (optional v1 — kill SIGTERM) |
| `GET` | `/api/terminal/history` | `?chatId=` | `{ runs: TerminalRunRecord[] }` (from session file) |

**SSE event types** (JSON in `data:` line):

```json
{ "type": "meta", "runId": "…", "command": "npm test", "cwd": "…" }
{ "type": "stdout", "text": "line chunk" }
{ "type": "stderr", "text": "line chunk" }
{ "type": "exit", "code": 0, "timedOut": false }
{ "type": "error", "message": "…" }
```

**Heartbeat:** comment line or `event: ping` every 15s while run active (keeps proxies alive).

### Refactor `toolExecuteCommand`

1. If request includes header `X-Minnow-Stream: 1` **or** body `stream: true`, delegate to `createRun` + wait for completion, still return **same formatted string** as today for tool history (`formatProcessOutput`).
2. Non-streaming path keeps current behavior for smoke scripts and backward compatibility.

Alternatively (cleaner): **only** the client terminal path uses `/api/terminal/*`; `POST /api/tools` `execute_command` internally calls `createRun` + `waitForRun()` without SSE when no subscribers — implementer picks one approach and documents in `context.md`.

### Persistence (Step 02)

On `finishRun`:

1. Append summary to session’s `terminalHistory` (last **50** runs per chat, prune oldest).
2. Write full log to `~/.minnow/logs/terminal/<runId>.log`.
3. `PUT` session via Step 02 API (or debounced save helper).

**`TerminalRunRecord` schema:**

```typescript
interface TerminalRunRecord {
  id: string;
  command: string;
  cwd: string;
  source: 'user' | 'agent';
  toolCallId?: string;
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  timedOut: boolean;
  logPath: string; // relative to ~/.minnow
}
```

---

## Client

### New files

| File | Purpose |
|------|---------|
| [`src/ui/terminal-panel.ts`](../../../src/ui/terminal-panel.ts) | Panel open/close, resize, output viewport, history list, user input |
| [`src/api/terminal.ts`](../../../src/api/terminal.ts) | `startRun`, `subscribeRunStream`, `cancelRun`, `loadTerminalHistory` |
| [`src/styles/terminal.css`](../../../src/styles/terminal.css) | Docked panel, monospace output, resize handle |
| [`test/terminal-stream.test.mjs`](../../test/terminal-stream.test.mjs) | Stream endpoint tests (see Verification) |

### Types ([`src/types.ts`](../../../src/types.ts))

- Export `TerminalRunRecord`.
- Extend `Chat` with optional `terminalHistory?: TerminalRunRecord[]`.
- Extend `SessionState` / migration only if history stays in session blob.

### UI behavior

| Feature | Spec |
|---------|------|
| **Placement** | Inside `.main-column`, **above** `.input-bar`, below `.chat-area` |
| **Toggle** | Top bar button `#btnTerminal` + keyboard shortcut `Ctrl+`` (backtick) — register in [`src/main.ts`](../../../src/main.ts) |
| **Collapsed state** | Persist in `~/.minnow/config.json` → `terminal.open` |
| **Resize** | Drag handle on top edge; min 120px, max 50% viewport; persist `terminal.heightPx` |
| **Output** | Auto-scroll when pinned to bottom; pause auto-scroll if user scrolls up |
| **History sidebar** | List prior runs for **active chat**; click loads log tail from server (`GET /api/terminal/log/:runId` optional) or cached summary |
| **User run** | Input + Run button → `source: 'user'`; disabled while server offline |
| **Server offline** | Panel shows banner: “Terminal requires npm start” (mirror tools banner) |

### Tool integration ([`src/tools/client.ts`](../../../src/tools/client.ts))

Add `executeCommandWithStream(name, args, hooks)`:

- For `execute_command`, `run_javascript`, `run_python` when `getLocalServerAvailable()`:
  1. `POST /api/terminal/run` with mapped command string.
  2. Open `EventSource` or `fetch` stream reader on `/api/terminal/stream/:runId`.
  3. Forward chunks to `terminalPanel.appendOutput(runId, stream, text)`.
  4. On `exit`, resolve formatted result string (same shape as `formatProcessOutput` for tool bubble).

[`src/tools/loop.ts`](../../../src/tools/loop.ts): pass `chat.id` and `toolCallId` into execute hooks when rendering tool calls.

### Layout CSS

- `.main-column` remains column flex; `.chat-area` gets `flex: 1; min-height: 0`.
- When terminal open, reduce chat flex — **do not** overlay chat (dock, not modal).
- Mobile: terminal max 40% height; stats strip stays below input (unchanged order).

---

## API client sketch (`src/api/terminal.ts`)

Implementer implements; this is the contract:

```typescript
export interface TerminalRunStart {
  runId: string;
  startedAt: number;
}

export type TerminalStreamEvent =
  | { type: 'meta'; runId: string; command: string; cwd: string }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'exit'; code: number | null; timedOut: boolean }
  | { type: 'error'; message: string };

export async function startTerminalRun(body: {
  command: string;
  chatId: string;
  source: 'user' | 'agent';
  toolCallId?: string;
}): Promise<TerminalRunStart>;

export function streamTerminalRun(
  runId: string,
  onEvent: (ev: TerminalStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void>;
```

Use **`fetch` + `ReadableStream`** parser (not browser `EventSource`) if `POST` auth headers are needed later — parse `data: ` lines like [`parseSsePayloads`](../../../src/api/chat.ts).

---

## Markup changes ([`index.html`](../../../index.html))

Inside `.main-column`, after `</main>` / before `.input-bar`:

```html
<section class="terminal-panel hidden" id="terminalPanel" aria-label="Terminal">
  <header class="terminal-header">… toggle, clear, run history …</header>
  <div class="terminal-resize-handle" id="terminalResize" role="separator" aria-orientation="horizontal"></div>
  <div class="terminal-body">
    <aside class="terminal-history" id="terminalHistory"></aside>
    <pre class="terminal-output" id="terminalOutput"></pre>
  </div>
  <form class="terminal-input-row" id="terminalForm">…</form>
</section>
```

Top bar: add `#btnTerminal` next to settings.

---

## Verification

### Automated — `test/terminal-stream.test.mjs`

Run with server up: `node test/terminal-stream.test.mjs http://localhost:5173`

| Test | Setup | Expected (static) |
|------|--------|-------------------|
| `run_returns_runId` | `POST /api/terminal/run` `{ command: "echo MINNOW_STREAM_OK" }` | JSON body contains `"runId"` matching `/^[a-f0-9-]{36}$/` or project id format |
| `stream_emits_stdout_and_exit` | Stream `runId` from above | Parsed events include `stdout` with `MINNOW_STREAM_OK` and `exit` with `code: 0` |
| `unknown_run_404` | `GET /api/terminal/stream/00000000-0000-0000-0000-000000000000` | HTTP 404 |
| `invalid_command_400` | `POST` missing `command` | HTTP 400, JSON `error` |
| `history_scoped_to_chat` | Two `chatId`s, one run each | `GET /api/terminal/history?chatId=A` lists only A’s run |

Use **fixed** `chatId` strings: `11111111-1111-1111-1111-111111111111`, `22222222-2222-2222-2222-222222222222`.

### Manual checklist

1. `npm start` → open terminal → run `echo hello` → see streaming output.
2. Enable `execute_command` → ask model to run `node -e "console.log(1)"` → panel streams during tool turn; tool bubble shows final result.
3. Switch chat → history list shows only that chat’s runs.
4. Reload page (after Step 02) → history restores.
5. Collapse terminal → chat area expands; preference persists.
6. `npm run dev` (no API) → terminal shows offline banner; user run disabled.
7. Command exceeding 30s → `timedOut: true`, exit event, tool result mentions timeout.

### Verifier handoff

Create [`documentation/plans/verification/step-10.md`](../verification/step-10.md) with exact commands and expected output (implementer). Verifier runs tests only — no feature code.

---

## Acceptance criteria

- [ ] Bottom **docked** terminal panel below chat, collapsible and resizable.
- [ ] **SSE** (or documented WebSocket) live stream of stdout/stderr for server runs.
- [ ] AI **`execute_command`** runs appear in the panel while executing.
- [ ] **Per-chat command history** persisted under Step 02 (`terminalHistory` + log files).
- [ ] **`test/terminal-stream.test.mjs`** passes against `npm start`.
- [ ] [`documentation/context.md`](../../context.md) updated (layout, routes, session fields).
- [ ] No regression: existing `POST /api/tools` `execute_command` still works for [`scripts/sa16-smoke.mjs`](../../scripts/sa16-smoke.mjs) when streaming flag off.

---

## Implementation todos

### Phase A — Server streaming core

- [ ] **A1** Create `RunState` registry and `createRun` / `finishRun` in `server.js` (or `server/terminal-runner.js`).
- [ ] **A2** Refactor `runProcess` to support `onStdout` / `onStderr` callbacks without breaking git/tools callers.
- [ ] **A3** Implement `POST /api/terminal/run` with validation and `runId` generation (use `crypto.randomUUID()`).
- [ ] **A4** Implement `GET /api/terminal/stream/:runId` SSE (meta → chunks → exit).
- [ ] **A5** Append each run to `~/.minnow/logs/terminal/<runId>.log` (Step 02 path helper).
- [ ] **A6** Wire `toolExecuteCommand` to shared runner; preserve `formatProcessOutput` return shape.
- [ ] **A7** (Optional v1) `POST /api/terminal/cancel/:runId` — SIGTERM child.
- [ ] **A8** Add `GET /api/terminal/history?chatId=` reading session blob from Step 02 store.

### Phase B — Client API and types

- [ ] **B1** Add `TerminalRunRecord` and `Chat.terminalHistory` in [`src/types.ts`](../../../src/types.ts).
- [ ] **B2** Implement [`src/api/terminal.ts`](../../../src/api/terminal.ts) — `startTerminalRun`, `streamTerminalRun`, SSE parser.
- [ ] **B3** Extend session load/save to include `terminalHistory` (Step 02 API or temporary `sessions.ts` field).
- [ ] **B4** Add `executeToolWithTerminalStream` path in [`src/tools/client.ts`](../../../src/tools/client.ts) for code tools.
- [ ] **B5** Hook [`src/tools/loop.ts`](../../../src/tools/loop.ts) — pass `chatId`, `toolCallId`, notify terminal before/after `executeTool`.

### Phase C — Terminal UI

- [ ] **C1** Add panel markup to [`index.html`](../../../index.html) and `#btnTerminal` in top bar.
- [ ] **C2** Create [`src/styles/terminal.css`](../../../src/styles/terminal.css); import from [`src/main.ts`](../../../src/main.ts).
- [ ] **C3** Implement [`src/ui/terminal-panel.ts`](../../../src/ui/terminal-panel.ts) — open/close, resize, output buffer, auto-scroll.
- [ ] **C4** History list UI — load on chat switch (`renderSidebar` / `switchToChat` hook).
- [ ] **C5** User command input — `source: 'user'`, clear output on new run.
- [ ] **C6** Offline / server banner when `!getLocalServerAvailable()`.
- [ ] **C7** Persist `terminal.open` and `terminal.heightPx` via Step 02 config API.
- [ ] **C8** Register `Ctrl+`` shortcut and Escape to blur input (not close drawer).

### Phase D — Tests and docs

- [ ] **D1** Add [`test/terminal-stream.test.mjs`](../../test/terminal-stream.test.mjs) (all cases in Verification table).
- [ ] **D2** Document command in README Testing section: `node test/terminal-stream.test.mjs <baseUrl>`.
- [ ] **D3** Update [`documentation/context.md`](../../context.md) — architecture diagram, routes table, `Chat.terminalHistory`.
- [ ] **D4** Create [`documentation/plans/verification/step-10.md`](../verification/step-10.md) for verifier agent.
- [ ] **D5** Run `npm run build` + stream tests + `node scripts/sa16-smoke.mjs` — no regressions.

### Phase E — Integration polish

- [ ] **E1** Map `run_javascript` / `run_python` to display commands in panel (`node -e …`, `python -c …`).
- [ ] **E2** On tool run start, auto-open terminal if `config.terminal.autoOpenOnAgentRun` (default **true**).
- [ ] **E3** Truncate displayed output at 2 MB with message; full log still on disk.
- [ ] **E4** Ensure mobile layout: terminal does not cover composer (resize max height).
- [ ] **E5** `aria-live="polite"` on output region for accessibility.

---

## Files touched (summary)

| Action | Path |
|--------|------|
| Edit | [`server.js`](../../../server.js) |
| Add | `server/terminal-runner.js` (optional) |
| Edit | [`index.html`](../../../index.html) |
| Add | [`src/ui/terminal-panel.ts`](../../../src/ui/terminal-panel.ts) |
| Add | [`src/api/terminal.ts`](../../../src/api/terminal.ts) |
| Add | [`src/styles/terminal.css`](../../../src/styles/terminal.css) |
| Edit | [`src/main.ts`](../../../src/main.ts) |
| Edit | [`src/types.ts`](../../../src/types.ts) |
| Edit | [`src/tools/client.ts`](../../../src/tools/client.ts) |
| Edit | [`src/tools/loop.ts`](../../../src/tools/loop.ts) |
| Edit | [`src/state/sessions.ts`](../../../src/state/sessions.ts) (until Step 02 session service replaces) |
| Add | [`test/terminal-stream.test.mjs`](../../test/terminal-stream.test.mjs) |
| Edit | [`documentation/context.md`](../../context.md) |
| Add | [`documentation/plans/verification/step-10.md`](../verification/step-10.md) |

---

## Sub-agent handoff (implementer)

1. Read [`documentation/context.md`](../../context.md) and **Step 02** deliverable (session + log paths).
2. Implement **Phase A → B → C → D → E** in order; do not ship UI without working stream endpoint.
3. Keep **English** identifiers and comments; return early for validation errors.
4. Update **context.md** when routes or session shape change.
5. Leave Step 20 settings (full terminal page) as stubs only — toggle/auto-open in `config.json` is enough.

## Sub-agent handoff (verifier)

1. Confirm Step 02 is merged or document waiver for history persistence tests.
2. Run `npm start`, then `node test/terminal-stream.test.mjs http://localhost:<port>`.
3. Execute manual checklist above.
4. Report **PASS** / **FAIL** in `documentation/plans/verification/step-10.md`.

---

## Related references

- Roadmap step summary: [`to-fix-step-order.md`](../to-fix-step-order.md) § Step 10
- Tool catalog: [`src/tools/definitions.ts`](../../../src/tools/definitions.ts) — `execute_command`
- Existing smoke pattern: [`scripts/sa16-smoke.mjs`](../../scripts/sa16-smoke.mjs)
