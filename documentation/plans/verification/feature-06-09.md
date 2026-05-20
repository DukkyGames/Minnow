# Feature 06–09 — Interactive PTY terminal verification

**Feature ID:** `feature-06-07-08-09-terminal-pty`  
**Epic:** D1

## Automated

```bash
npm test
npm run test:terminal-pty   # requires npm start; set TERMINAL_TEST_BASE=http://127.0.0.1:5173
node test/terminal-stream.test.mjs http://127.0.0.1:5173
```

| Check | Pass criteria |
|-------|---------------|
| Unit | `shell-profiles.test.mjs`, `pty-protocol.test.mjs` in `npm test` |
| PTY integration | `pty-session.test.mjs` — session create, WS echo, delete |
| SSE regression | `terminal-stream.test.mjs` — run/stream/cancel (history test may need clean `MINNOW_HOME`) |

## Manual (Windows-primary)

| # | Scenario | Pass |
|---|----------|------|
| M1 | `npm start` → Terminal → PowerShell → `cd` / `npm -v` | Interactive prompt, colors |
| M2 | `git che` + Tab | Shell completion |
| M3 | ↑ after two commands | History recalled |
| M4 | **+** second tab (cmd) | Independent sessions |
| M5 | Close tab | Other tab still works |
| M6 | Resize panel | xterm reflow |
| M7 | Ctrl+C | Interrupts command |
| M8 | Agent `execute_command` | Agent output strip + Agent runs sidebar |
| M9 | Reload | Tab chrome restores; new PTYs |
| M10 | `npm run dev` | Offline banner; no WS errors |

## Sign-off gate

- [ ] Dual backend: agents use SSE runs, user uses PTY only
- [ ] D1 acceptance: PTY, tabs, profiles, Tab/↑/↓, resize
