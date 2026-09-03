# MIN-670 — macOS terminal history shows `^A^K`

## Problem

On an **already-used** PTY tab (macOS zsh), ArrowUp recalls history as literal caret notation:

```text
henri@Henris-MacBook-Pro integration % ^A^Knpm run dev
```

A **fresh** tab (no commands yet) recalls history correctly.

## Root cause

[`src/ui/terminal-xterm.ts`](../../src/ui/terminal-xterm.ts) intercepts ArrowUp/Down and injects [`HISTORY_LINE_CLEAR`](../../src/ui/terminal-history-nav.ts) (`Ctrl+A` + `Ctrl+K`, `\x01\x0b`) plus the stored line.

That intercept is skipped when `tabHistory.length === 0`, so a new tab **passes arrows through to zsh** and native `zle` history works. After the first command, Minnow has localStorage history, swallows the arrow, and writes `\x01\x0b`. zsh (emacs unbound keys, vi-insert, or cooked `echoctl`) **self-inserts** those bytes as `^A^K` instead of clearing the line.

The same footgun is already documented for PowerShell/cmd: `usesShellNativeHistory` passes arrows through so client-side recall does not fight PSReadLine. zsh/bash/WSL were left on the inject path.

### Follow-up: `^[[A` / `^[[B` after the first command

Pass-through fixed `^A^K`, but a used macOS zsh tab then printed raw CSI (`^[[A` for Up, `^[[B` for Down). Extra Enter, then Up, recalled history correctly.

**Cause:** after `accept-line`, zsh is briefly in cooked mode until zle restarts (SMKX / `\e[?2004h`). xterm.js parses that output asynchronously, so ArrowUp can reach the PTY before zle is raw again and `echoctl` paints the caret sequence. Fix: queue PTY input until `term.write` completes ([`terminal-pty-input-gate.ts`](../../src/ui/terminal-pty-input-gate.ts)), spawn with a sanitized env, and avoid a SIGWINCH storm on prompt redraw.

## Todos

- [x] Pass ArrowUp/Down through for zsh, bash, fish, and `wsl:*` (same as powershell/cmd)
- [x] Unit-test the intercept gate so a used zsh tab does not consume arrows
- [x] Keep Ctrl+A/Ctrl+K replace only as a fallback for unknown shells
- [x] Update [`documentation/context.md`](../context.md) PTY history note
- [x] Run `terminal-history-nav` tests
- [x] PTY regression: bash vi-mode echoes `HISTORY_LINE_CLEAR` as `^A^K`; native ArrowUp does not
- [x] Queue keystrokes until xterm finishes parsing output so CSI arrows are not sent in cooked mode (`^[[A`)
- [x] Sanitize PTY env (drop COLUMNS/LINES/TERMCAP); spawn unix shells as `-il`
- [x] Fit PTY to the viewport before spawn; debounce SIGWINCH from ResizeObserver

## Out of scope

- Changing zsh/bash `HISTFILE` behaviour
- Removing per-tab `localStorage` command tracking (still used to record submitted lines; navigation no longer consumes it for known shells)
