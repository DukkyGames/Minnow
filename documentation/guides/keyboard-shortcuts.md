# Keyboard shortcuts

Bindings for the Minnow SPA and Electron shell. **Mod** means **Ctrl** on Windows/Linux and **Cmd** on macOS.

For npm scripts, the headless CLI, and environment variables, see [Commands](commands.md).

Most single-key shortcuts (mail triage, tool approval digits) are **suppressed while focus is in a text field** (`input`, `textarea`, `select`, or `contenteditable`). Modified chords (Mod+…) generally still work from inputs when the handler explicitly allows them.

---

## Global

| Keys | Action |
|------|--------|
| **Escape** | Close open overlays and popovers (tools permissions, context usage breakdown, code-change panel, modals, drawers, and other dismissible layers). Wired from [`src/main.ts`](../../src/main.ts) and per-surface handlers. |
| **Mod+A** | Select all **within the focused panel** (chat transcript, editor, preview, orchestrate chat pane, onboarding chat) instead of the whole app shell ([`scoped-select-all.ts`](../../src/ui/scoped-select-all.ts)). Native controls and CodeMirror/xterm keep their built-in select-all. |
| **Tab** / **Shift+Tab** | Move focus through dock, menubar, sidebars, and app chrome (standard browser tab order). |
| **Ctrl+Tab** / **Ctrl+Shift+Tab** | Cycle between **Desktop** and recently used Minnow apps (dock apps), macOS **Cmd+Tab**–style within Minnow. Uses **Ctrl** only — not **Cmd** on macOS (system app switcher) and not **Mod+Tab** in the Code editor (file tabs). When the Code editor or unified tab strip has focus on Windows/Linux, **Ctrl+Tab** still cycles file tabs there first. |

---

## Chat & composer

Applies to Code workspace composers (`#msgInput`) and equivalent chat surfaces unless noted.

| Keys | Action |
|------|--------|
| **Enter** | Send message (or **Stop** while streaming when the send button is in stop mode). |
| **Shift+Enter** | Insert a newline without sending. |
| **/** | Open the slash **skill picker** when typed at the start of the composer ([`skill-picker.ts`](../../src/ui/skill-picker.ts)). |
| **↑** / **↓** | Browse **per-chat prompt history** when the caret is at the start (↑) or end (↓) of the composer ([`composer-prompt-history.ts`](../../src/ui/composer-prompt-history.ts)). |
| **↑** / **↓** / **Enter** / **Tab** / **Escape** | Navigate and confirm the slash picker while it is open. |
| **1** / **2** / **3** | Tool approval strip: allow once, always allow, cancel ([`tool-approval-modal.ts`](../../src/ui/tool-approval-modal.ts)). Plain digit keys only (no modifiers). |

### Chat search popover

Opened from the sidebar **Search** button (`btnChatSearch` / `btnDesktopChatSearch`), not a global chord.

| Keys | Action |
|------|--------|
| **↑** / **↓** | Move highlight in results. |
| **Enter** | Open the highlighted chat. |
| **Escape** | Close the popover. |

### Model picker (top bar)

| Keys | Action |
|------|--------|
| **Escape** | Close the model list menu ([`model-select-picker.ts`](../../src/ui/model-select-picker.ts)). |

---

## Chat sidebar

| Keys / input | Action |
|--------------|--------|
| **Enter** / **Space** | Activate focused chat row. |
| **Escape** | Clear multi-selection when chats are selected. |
| **Mod+click** | Toggle chat in multi-selection. |
| **Shift+click** | Range-select chats from the last anchor. |

---

## Code editor (file viewer)

Minnow-specific bindings on top of CodeMirror 6 defaults ([`file-editor-keymap.ts`](../../src/ui/file-editor-keymap.ts), [`editor-quick-edit`](../../src/ui/editor-quick-edit/), [`editor-intent-mode`](../../src/ui/editor-intent-mode/), [`file-editor-ai-extensions.ts`](../../src/ui/file-editor-ai-extensions.ts)).

| Keys | Action |
|------|--------|
| **Mod+K** | **Quick Edit** on the current selection ([`editor-quick-edit/extensions.ts`](../../src/ui/editor-quick-edit/extensions.ts)). |
| **Mod+I** | Toggle **Intent mode** ([`editor-intent-mode/extensions.ts`](../../src/ui/editor-intent-mode/extensions.ts)). |
| **Mod+W** | Close the active file tab. |
| **Mod+Tab** / **Mod+Shift+Tab** | Cycle file tabs forward / backward. |
| **Tab** | Accept inline **AI ghost** text, accept an open **LSP completion**, or indent (policy in [`editor-completion-policy.ts`](../../src/ui/editor-completion-policy.ts)). |
| **Shift+Tab** | Outdent when LSP does not own Tab. |
| **Mod+→** | Accept the next word/chunk of AI ghost text. |
| **Escape** | Dismiss AI ghost if visible; otherwise blur the editor so focus can leave the code surface. |
| **Ctrl+Space** | Open LSP symbol completion (macOS also: **Alt+`**, **Alt+I**). |
| **↑** / **↓** | Move through LSP completion menu. |
| **F12** | Go to definition. |
| **Mod+click** | Go to definition at click position ([`lsp-editor/definition.ts`](../../src/ui/lsp-editor/definition.ts)). |
| **Mod+F** | Find / replace panel (CodeMirror search). |
| **Mod+G** / **Mod+Shift+G** | Find next / previous match. |
| **Mod+Z** / **Mod+Shift+Z** | Undo / redo (CodeMirror history). |
| **Mod+D** | Select next occurrence (CodeMirror default). |
| **F2** | Rename file when the tree row is focused or when the editor is focused (renames the open file). |

**Intent mode** (when enabled): leave a plain-text intent line to resolve it; revert via the resolved-line control or click ([`editor-intent-settings.ts`](../../src/ui/editor-intent-settings.ts)).

---

## File tree

Focus the tree (`#fileTreeHost`) unless the CodeMirror editor is focused (tree copy/paste/delete shortcuts are skipped while typing in the editor).

| Keys | Action |
|------|--------|
| **Enter** / **Space** | Expand or collapse a directory row; activate file row. |
| **F2** | Rename focused row or open file. |
| **Mod+C** / **Mod+X** / **Mod+V** | Copy / cut / paste file paths in the workspace. |
| **Delete** | Delete focused file or directory. |

Filter field (`#fileTreeSearch`): type to filter; no dedicated open shortcut.

---

## Editor tabs & preview

Right-hand tab strip ([`unified-right-tabs.ts`](../../src/ui/unified-right-tabs.ts)) when tabs have focus or the strip handler is active:

| Keys | Action |
|------|--------|
| **Mod+W** | Close active file or preview tab. |
| **Mod+Tab** / **Mod+Shift+Tab** | Cycle tabs forward / backward. |
| **←** / **→** | Move between file and preview tabs when the strip is focused. |

### In-app preview pane

| Keys | Action |
|------|--------|
| **F12** | Toggle preview DevTools (Electron). |
| **Mod+Shift+I** | Same as F12 while preview is on screen ([`preview-panel.ts`](../../src/ui/preview-panel.ts)). |

---

## Terminal

| Keys | Action |
|------|--------|
| **Ctrl+`** | Toggle terminal panel ([`terminal-panel.ts`](../../src/ui/terminal-panel.ts)). Note: **Mod+`** is not bound on macOS for this toggle. |
| **Mod+C** | Copy selected terminal text when a selection exists; otherwise sends **Ctrl+C** to the shell (SIGINT) ([`terminal-copy-shortcut.ts`](../../src/ui/terminal-copy-shortcut.ts)). |

---

## Settings

| Keys | Action |
|------|--------|
| **Mod+K** | Focus the **Settings search** field when Settings is open ([`settings-search-finder.ts`](../../src/ui/settings-search-finder.ts)). |
| **↑** / **↓** / **Enter** / **Escape** | Navigate and open search results; Escape also blurs the finder. |
| **Escape** | Close Settings drawer overlays and trap focus in open lightboxes. |

---

## Orchestrate board

| Keys | Action |
|------|--------|
| **Tab** | Move between header controls and task cards. |
| **←** / **→** / **↑** / **↓** | Change **execution mode** segment when a mode button is focused ([`orchestrate-board.ts`](../../src/ui/orchestrate-board.ts)). |
| **Enter** / **Space** | Activate focused task card or control. |

---

## Issues

| Keys / input | Action |
|--------------|--------|
| **Mod+click** | Toggle issue in multi-selection. |
| **Shift+click** | Range-select issues on the list or board. |
| **Shift+F10** / **Context Menu** | Open row/card context menu. |
| **Mod+Enter** | Save description edit in issue detail. |
| **Escape** | Cancel description edit. |

---

## Email (hidden app)

Gmail-style bindings when the mail surface is focused and **not** typing in a field ([`email-keyboard.ts`](../../src/ui/email/email-keyboard.ts)). Press **?** in the mail app for the in-app cheat sheet.

| Keys | Action |
|------|--------|
| **j** / **k** | Next / previous conversation |
| **Enter**, **o** | Open conversation |
| **u** | Back to list |
| **e** | Archive |
| **#** | Trash |
| **s** | Star |
| **x** | Select |
| **r** / **a** / **f** | Reply / reply all / forward |
| **c** | Compose |
| **/** | Search |
| **z** | Undo last action |
| **Mod+Enter** | Send from compose ([`email-compose.ts`](../../src/ui/email/email-compose.ts)) |
| **?** | Shortcut list overlay |

---

## Modals, drawers, and overlays

Common patterns across sub-agent drawer, question cards, git lightboxes, research activity overlay, notifications menu, and app dialogs:

| Keys | Action |
|------|--------|
| **Escape** | Close the topmost overlay and restore focus where implemented. |
| **Tab** / **Shift+Tab** | Cycle focus within trapped dialogs (sub-agent drawer, settings lightboxes, keyboard help sheets). |

---

## Source map

| Area | Primary module |
|------|----------------|
| Global Escape | [`src/main.ts`](../../src/main.ts) |
| App surface cycle | [`src/os/app-focus-cycle.ts`](../../src/os/app-focus-cycle.ts) |
| Floating window cycle | [`src/os/window-focus-cycle.ts`](../../src/os/window-focus-cycle.ts) |
| Composer | [`src/ui/input.ts`](../../src/ui/input.ts), [`src/ui/skill-picker.ts`](../../src/ui/skill-picker.ts) |
| Editor | [`src/ui/file-editor-keymap.ts`](../../src/ui/file-editor-keymap.ts), [`src/ui/editor-core-extensions.ts`](../../src/ui/editor-core-extensions.ts) |
| File tree | [`src/ui/file-tree.ts`](../../src/ui/file-tree.ts) |
| Terminal | [`src/ui/terminal-panel.ts`](../../src/ui/terminal-panel.ts), [`src/ui/terminal-xterm.ts`](../../src/ui/terminal-xterm.ts) |
| Mail | [`src/ui/email/email-keyboard.ts`](../../src/ui/email/email-keyboard.ts) |
| Scoped select-all | [`src/ui/scoped-select-all.ts`](../../src/ui/scoped-select-all.ts) |

When adding a new shortcut, update this guide and the relevant in-app help (mail `?` sheet or future global help overlay).
