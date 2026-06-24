---
name: fix-emfile-log-write-concurrency
overview: Serialize concurrent log writes per file path in terminal-runner.js, servers/manager.js, and voice/runtime-manager.js to prevent EMFILE ("too many open files") errors when child process stdout/stderr chunks arrive faster than the OS can close file descriptors.
todos:
  - id: w1-serialize-terminal
    content: "Wave 1: Serialize appendLogFile writes per log path in terminal-runner.js"
    status: pending
  - id: w1-serialize-server-mgr
    content: "Wave 1: Serialize appendServerLog writes per server log path in servers/manager.js"
    status: pending
  - id: w1-serialize-voice
    content: "Wave 1: Serialize appendWorkerLog writes in voice/runtime-manager.js"
    status: pending
  - id: w2-test
    content: "Wave 2: Add a unit test for concurrent log write backpressure"
    status: pending
  - id: w2-verify
    content: "Wave 2: Verify no unhandledRejection in production by running a verbose agent command"
    status: pending
isProject: true
---

# Fix EMFILE "too many open files" from concurrent log writes

**Date:** 2026-06-24
**Goal:** Prevent `unhandledRejection: EMFILE: too many open files` when child process `data` chunks flood the async log append path with unbounded concurrent file descriptors.
**Granularity:** medium

## Context

When agents run verbose child-process commands (builds, npm install, large tool output), the child's stdout/stderr pipe fires `data` events hundreds or thousands of times per second. Each event calls a fire-and-forget `void appendLogFile(...)` which internally opens the log file with `fs.appendFile`. Since none of these promises are awaited, they all run concurrently — each holding an open file descriptor. When enough pile up before the OS can close them, Node hits the OS file descriptor limit and throws `EMFILE`.

This is an unhandled promise rejection because the `void` keyword discards the promise. The Node `unhandledRejection` handler logs it and keeps the server alive, but log writes are silently lost for the affected run.

The fix serializes writes to the same log file so at most one `fs.appendFile` call is in-flight per file at any time.

## Architecture / Key Files

| File | Role | Action |
|------|------|--------|
| `server/terminal-runner.js` (line 107) | Agent command log writer | MODIFY — add per-path write queue |
| `server/servers/manager.js` (line 124) | Dev server log writer | MODIFY — add per-server write queue |
| `server/voice/runtime-manager.js` (line 154) | Voice worker log writer | MODIFY — add write queue |
| `test/server/log-write-concurrency.test.mjs` | New regression test | CREATE |

## Wave Breakdown

### Wave 1 — Serialize log writes (3 files, all independent)

All three files get the same pattern: a per-path `Map<string, Promise<void>>` queue, chaining writes with `.then()` so only one append is in-flight per file.

#### Task W1-A: Serialize `appendLogFile` in `server/terminal-runner.js`

- **Build:**
  1. Open `server/terminal-runner.js`.
  2. Add a module-level `Map` above `appendLogFile`:
     ```js
     /** @type {Map<string, Promise<void>>} */
     const logWriteQueues = new Map();
     ```
  3. Replace the current `appendLogFile` function (lines 107–110):
     ```js
     async function appendLogFile(logPath, text) {
       if (!text) return;
       await fs.mkdir(path.dirname(logPath), { recursive: true });
       await fs.appendFile(logPath, text, 'utf8');
     }
     ```
     With the serialized version:
     ```js
     async function appendLogFile(logPath, text) {
       if (!text) return;
       const prev = logWriteQueues.get(logPath) ?? Promise.resolve();
       const next = prev.then(async () => {
         await fs.mkdir(path.dirname(logPath), { recursive: true });
         await fs.appendFile(logPath, text, 'utf8');
       }).catch(() => {
         /* A failed write shouldn't poison the queue for this file. */
       }).finally(() => {
         if (logWriteQueues.get(logPath) === next) {
           logWriteQueues.delete(logPath);
         }
       });
       logWriteQueues.set(logPath, next);
       return next;
     }
     ```
  4. No call site changes needed — the 5 `void appendLogFile(...)` calls (lines 228, 233, 350, 357, 369) remain unchanged; they now chain onto the queue instead of running concurrently.
- **Test:** Run `node --test test/server/log-write-concurrency.test.mjs` if it exists yet (see Wave 2); otherwise verify manually that `node -e "require('./server/terminal-runner.js')"` loads without syntax error.
- **Accept:** After the fix, a verbose `npm run build` captured by a terminal run no longer triggers `unhandledRejection EMFILE` in the server console.
- **Depends on:** none

#### Task W1-B: Serialize `appendServerLog` in `server/servers/manager.js`

- **Build:**
  1. Open `server/servers/manager.js`.
  2. Add a module-level `Map` above `appendServerLog`:
     ```js
     /** @type {Map<string, Promise<void>>} */
     const serverLogWriteQueues = new Map();
     ```
  3. Replace `appendServerLog` (lines 124–141) so the `fs.appendFile` at line 140 is serialized per `serverId`:
     ```js
     async function appendServerLog(serverId, chunk) {
       const text = String(chunk);
       if (!text) return;

       const lines = logRingBuffers.get(serverId) ?? [];
       for (const line of text.split(/\r?\n/)) {
         if (!line) continue;
         lines.push(line);
       }
       while (lines.length > LOG_RING_MAX_LINES) {
         lines.shift();
       }
       logRingBuffers.set(serverId, lines);

       const logPath = getServerLogPath(serverId);
       const prev = serverLogWriteQueues.get(logPath) ?? Promise.resolve();
       const next = prev.then(async () => {
         await fsp.mkdir(path.dirname(logPath), { recursive: true });
         await fsp.appendFile(logPath, text, 'utf8');
       }).catch(() => {}).finally(() => {
         if (serverLogWriteQueues.get(logPath) === next) {
           serverLogWriteQueues.delete(logPath);
         }
       });
       serverLogWriteQueues.set(logPath, next);
       return next;
     }
     ```
  4. No call site changes needed — the 4 `void appendServerLog(...)` calls (lines 371, 374, 381, 387) remain unchanged.
- **Test:** Run `node -e "require('./server/servers/manager.js')"` to verify module loads without syntax error.
- **Accept:** Dev server log appends from verbose child processes no longer contribute to EMFILE.
- **Depends on:** none

#### Task W1-C: Serialize `appendWorkerLog` in `server/voice/runtime-manager.js`

- **Build:**
  1. Open `server/voice/runtime-manager.js`.
  2. Add a module-level `Map` (or a single `let` since there's only one log file) above `appendWorkerLog`:
     ```js
     /** @type {Promise<void> | null} */
     let voiceLogWriteChain = null;
     ```
  3. Replace `appendWorkerLog` (lines 154–164) so the `fsp.appendFile` at line 160 is serialized:
     ```js
     async function appendWorkerLog(chunk) {
       const text = String(chunk);
       if (!text) return;
       const logPath = getVoiceLogPath();
       const prev = voiceLogWriteChain ?? Promise.resolve();
       const next = prev.then(async () => {
         await fsp.mkdir(path.dirname(logPath), { recursive: true }).catch(() => {});
         try {
           await fsp.appendFile(logPath, text, 'utf8');
         } catch {
           /* ignore log write failures */
         }
       }).catch(() => {}).finally(() => {
         if (voiceLogWriteChain === next) voiceLogWriteChain = null;
       });
       voiceLogWriteChain = next;
     }
     ```
  4. No call site changes needed — the 4 `void appendWorkerLog(...)` calls (lines 308, 311, 318, 325) remain unchanged.
- **Test:** Run `node -e "require('./server/voice/runtime-manager.js')"` to verify module loads without syntax error.
- **Accept:** Voice worker log appends no longer contribute to EMFILE.
- **Depends on:** none

### Wave 2 — Regression test + smoke verification

Tasks here depend on Wave 1 being complete.

#### Task W2-A: Add concurrency unit test

- **Build:**
  1. Create `test/server/log-write-concurrency.test.mjs`.
  2. Test: simulate ~500 rapid concurrent calls to the serialized `appendLogFile` and assert no `EMFILE` is thrown.
  3. Use `node:fs/promises` with a temp directory (`node:test` + `tmpdir`). Assert the file contains the expected concatenated content.
  4. The test should import the serialized helper (or inline a minimal reproduction of the pattern) and call it 500 times in a tight loop, then await all promises.
  5. Use `node --test` conventions (describe/it or direct test blocks).
- **Test:** Run `node --test test/server/log-write-concurrency.test.mjs`. It must pass.
- **Accept:** Test proves 500 rapid writes to a single file path produce the correct output without EMFILE.
- **Depends on:** w1-serialize-terminal

#### Task W2-B: Smoke test with a real verbose agent command

- **Build:** No code changes. Manual verification step.
- **Test:**
  1. Start the server (`npm start`).
  2. Run an agent command that produces heavy output — e.g., `npm run build` or a recursive grep — via `start_background_command`.
  3. Check the server console for `unhandledRejection EMFILE`.
  4. Check `read_command_log` to confirm log output is intact (not truncated or missing).
- **Accept:** No `EMFILE` errors in the server stderr. Log file is complete.
- **Depends on:** w1-serialize-terminal

## Verification Checklist

- [ ] `node --test test/server/log-write-concurrency.test.mjs` passes
- [ ] Verbose agent command (e.g., `npm run build`) captured via terminal runner produces no `EMFILE` unhandled rejections
- [ ] Existing test suite does not regress: relevant subset via `node --test test/server/*.test.mjs`
- [ ] Log files from verbose runs are complete and not truncated

## Notes for Build Agents

- The fix is **surgical** — only the three `appendLogFile`/`appendServerLog`/`appendWorkerLog` function bodies change. Call sites stay the same.
- The `catch(() => {})` ensures a single write failure doesn't block all future writes to that file. This is the same "best-effort logging" posture as the existing code.
- The `finally` cleanup ensures the Map/chain reference doesn't leak. The guard `if (queue.get(path) === next)` prevents a newer chain entry from being deleted by an older one's `finally`.
- Use `fs` imports already present: `terminal-runner.js` imports `fs from 'node:fs/promises'` as `fs`; `manager.js` imports as `fsp`; `runtime-manager.js` imports as `fsp`.
