# Keyboard shortcuts

**Mod** means **Ctrl** on Windows and Linux and **Cmd** on macOS.

Most single-key shortcuts (tool approval digits, mail triage when that app ships) are suppressed while focus is in a text field. Modified chords (**Mod+…**) usually still work when the handler allows it.

## Global

| Keys | Action |
|------|--------|
| **Escape** | Close open overlays, popovers, modals, and dismissible layers |
| **Mod+A** | Select all within the focused panel (chat, editor, Settings, etc.), not the whole shell |
| **Tab** / **Shift+Tab** | Move focus through dock, menubar, sidebars, and chrome |
| **Ctrl+Tab** / **Ctrl+Shift+Tab** | Cycle between Desktop and recently used dock apps (uses **Ctrl** even on macOS). In Code, file tabs may take **Ctrl+Tab** first when the editor has focus |

## Chat and composer

| Keys | Action |
|------|--------|
| **Enter** | Send (or **Stop** while streaming in stop mode) |
| **Shift+Enter** | New line without sending |
| **/** | Open slash skill picker at start of composer |
| **Mod+M** | Open per-chat model picker and focus search |
| **↑** / **↓** | Browse prompt history when caret is at start (↑) or end (↓) of composer |
| **↑** / **↓** / **Enter** / **Tab** / **Escape** | Navigate slash picker while open |
| **1** / **2** / **3** | Tool approval: once, always, cancel |

### Chat search popover

Opened from sidebar **Search**, not a global chord.

| Keys | Action |
|------|--------|
| **↑** / **↓** | Move highlight |
| **Enter** | Open highlighted chat |
| **Escape** | Close |

## Code editor

| Keys | Action |
|------|--------|
| **Mod+K** | Quick Edit on selection |
| **Mod+I** | Toggle Intent mode |
| **Mod+W** | Close active file tab |
| **Mod+Tab** / **Mod+Shift+Tab** | Cycle file tabs |
| **Tab** | Accept AI ghost, LSP completion, or indent |
| **Shift+Tab** | Outdent when LSP does not own Tab |
| **Mod+→** | Accept next word of ghost text |
| **Escape** | Dismiss ghost or blur editor |
| **Ctrl+Space** | LSP completion (macOS also **Alt+`**, **Alt+I**) |
| **F12** | Go to definition |
| **Mod+click** | Go to definition at click |
| **Mod+F** | Find / replace |
| **Mod+G** / **Mod+Shift+G** | Next / previous match |
| **Mod+Z** / **Mod+Shift+Z** | Undo / redo |
| **F2** | Rename tree row or open file |

## File tree

When the tree is focused and you are not typing in the editor:

| Keys | Action |
|------|--------|
| **Enter** / **Space** | Expand/collapse folder or open file |
| **F2** | Rename |
| **Mod+C** / **Mod+X** / **Mod+V** | Copy / cut / paste paths in workspace |
| **Delete** | Delete file or folder |

## Preview pane

| Keys | Action |
|------|--------|
| **F12** | Toggle DevTools |
| **Mod+Shift+I** | Same while preview visible |

## Terminal

| Keys | Action |
|------|--------|
| **Ctrl+`** | Toggle terminal panel (not **Mod+`** on macOS for this binding) |
| **Mod+C** | Copy selection, or send SIGINT to shell when nothing selected |

## Settings

| Keys | Action |
|------|--------|
| **Mod+K** | Focus Settings search when Settings is open |
| **↑** / **↓** / **Enter** / **Escape** | Navigate search results; Escape closes overlays |

## Issues

| Input | Action |
|-------|--------|
| **Mod+click** | Toggle multi-select |
| **Shift+click** | Range select |
| **Shift+F10** | Context menu |
| **Mod+Enter** | Save description edit |
| **Escape** | Cancel description edit |

## Wiki

While the Minnow wiki overlay is open:

| Keys | Action |
|------|--------|
| **Ctrl+K** / **Cmd+K** | Focus wiki search |

## Modals

**Escape** closes the top overlay; **Tab** cycles focus inside trapped dialogs.
