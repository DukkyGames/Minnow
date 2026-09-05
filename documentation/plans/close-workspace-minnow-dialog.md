# Close workspace Minnow dialog

Replace the native Windows `dialog.showMessageBox` close-workspace prompt with the existing in-app Minnow dialog (`app-dialog`).

## Status

Implemented.

## Todos

- [x] Extend `app-dialog` for a choice dialog: three actions, optional footer checkbox, arbitrary body
- [x] Style the remember checkbox with `--mn-*` tokens; keep actions in the existing button vocabulary
- [x] IPC: main asks the renderer to prompt; renderer returns `{ action, remember }`
- [x] Wire every current `promptWindowClose` path (window X, tray Close workspace, any other close that asks)
- [x] Fallback if the renderer is not ready: native MessageBox (same copy), so close never hangs
- [x] Tests for choice dialog, remember checkbox, IPC payload, and tray-close still honoring cancel/background/close
- [x] Update `documentation/context.md` Electron / in-app dialog notes
