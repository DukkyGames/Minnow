# Do not auto-open terminal on agent command

**Summary:** Stop raising the terminal panel when the agent runs shell tools unless the user has opted in via settings.

**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) — line 4

---

## Problem statement

Every agent-driven command calls `ensureTerminalPanelVisible()` when `terminal.autoOpenOnAgentRun` is true (the **default**). That hijacks layout during coding sessions where users prefer the file tree or chat full height.

---

## Current behavior

| Step | Behavior | Key paths |
|------|----------|-----------|
| Agent runs shell tool | `runCommandWithTerminalStream` in client | `src/tools/client.ts` → `src/ui/terminal-panel.ts` |
| Auto-open check | `if (options.source === 'agent' && meta.autoOpenOnAgentRun) ensureTerminalPanelVisible()` | `terminal-panel.ts` ~357–360 |
| Default pref | `autoOpenOnAgentRun: true` | `src/config/terminal-meta.ts`, `server/config/validators.js`, `server/config/home.js` |
| Persistence | `config.json` → `terminal` block | `GET/PUT` meta API via `terminal-meta.ts` |
| User terminal | `#btnTerminal` manual toggle; height/open persisted | `index.html`, `terminal-panel.ts` |

Streaming output still appends to the terminal buffer when the panel is closed; users only miss **visibility**, not execution.

---

## Proposed solution

### 1. Change default to off

- `DEFAULT_TERMINAL_META.autoOpenOnAgentRun = false`
- Server validator default `false` for new profiles (`server/config/validators.js`, `server/config/home.js`)
- Migration: existing users keep stored value; only **new** installs get false unless we bump schema and reset (document in changelog).

### 2. Settings toggle

- Settings → Terminal (or Tools): **“Open terminal when agent runs a command”** — binds to `terminal.autoOpenOnAgentRun`.
- If no settings UI exists for terminal yet, add one row in existing settings terminal section (grep `terminal-meta` consumers).

### 3. Optional unobtrusive signal

When panel stays closed but agent runs a command:

- Pulse `#btnTerminal` badge or set status pill: “Agent command running — click Terminal to view”
- Do not call `setPanelOpen(true)`.

### 4. Keep user-initiated open

- `source === 'user'` paths unchanged.
- Manual Terminal button unchanged.

---

## Implementation todos

- [ ] Set default `autoOpenOnAgentRun` to `false` in `terminal-meta.ts` and server defaults
- [ ] Add Settings UI checkbox + `saveTerminalMeta({ autoOpenOnAgentRun })`
- [ ] (Optional) Status / badge when agent run starts while panel closed
- [ ] Update `documentation/context.md` terminal prefs table
- [ ] Update test fixtures that assert `true` if any (`test/fixtures/memory-home-empty/config.json`)
- [ ] Manual QA: agent `run_terminal_cmd` with panel closed — panel stays closed; output in history when opened

---

## Files to change

| File | Change |
|------|--------|
| `src/config/terminal-meta.ts` | Default false |
| `server/config/validators.js` | Default false |
| `server/config/home.js` | Seed false for new homes |
| `src/ui/terminal-panel.ts` | Optional badge; keep guard |
| `src/ui/settings*.ts` | Toggle (locate terminal settings section) |
| `index.html` | Label copy if markup lives there |
| `documentation/context.md` | Document default |
| `test/fixtures/**/config.json` | Align fixture expectations |

---

## Testing plan

1. Fresh `MINNOW_HOME` temp dir — `config.json` has `autoOpenOnAgentRun: false`.
2. Agent tool run — `#terminalPanel` stays `hidden`.
3. Enable setting — agent run opens panel (regression).
4. User opens terminal manually — still works.
5. `npm test` — config validator tests if present.

---

## Risks / open questions

- **Breaking change:** Users who relied on auto-open may complain — release note + visible setting.
- **PTY vs one-shot:** Same flag for all agent shell tools?
- **Failed commands:** Still no auto-open on failure unless user wants “open on error” (out of scope)?
