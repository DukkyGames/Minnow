# Code app

Use **Code** when you want to edit a project folder with the assistant beside you: files, terminal, git, previews, and chat in one fullscreen workspace.

## Open Code

Click **Code** in the dock. The app opens fullscreen and keeps chat available in the Code layout.

## Set your workspace

1. Choose or confirm the **workspace folder** (your project root on disk).
2. File, git, and search tools resolve under this root for safety.

If the assistant cannot read a path outside the workspace, that is expected unless you changed advanced path policy in Settings.

## Typical workflow

| Step | Action |
|------|--------|
| 1 | Open the file tree and select a file. |
| 2 | Edit in the CodeMirror editor (syntax highlighting, LSP completions). |
| 3 | Set composer mode to **Build** for implementation tasks. |
| 4 | Ask for changes; approve tool runs when prompted. |
| 5 | Use the integrated **terminal** for commands (**Ctrl+`** toggles the panel on Windows/Linux). |
| 6 | Use git UI or ask the agent for status, diff, and commits. |

## Editor shortcuts (high level)

| Keys | Action |
|------|--------|
| **Ctrl+K** / **Cmd+K** | Quick Edit on selection |
| **Ctrl+I** / **Cmd+I** | Intent mode |
| **Ctrl+W** / **Cmd+W** | Close file tab |
| **Ctrl+Tab** | Cycle file tabs (Windows/Linux; see full list in reference) |
| **F12** | Go to definition |
| **Tab** | Accept AI ghost text or LSP completion |

Full bindings: [Keyboard shortcuts](../reference/keyboard-shortcuts.md).

## Browser preview

On the desktop shell, open the preview pane for workspace HTML or localhost URLs. Toggle **DevTools** with **F12**, **Ctrl+Shift+I**, or the toolbar control to inspect console and network for the previewed page.

## Drag to composer

Drag files from the tree into the composer to attach workspace references the model can read with tools.

## When to use Code vs desktop Chat

| Situation | Surface |
|-----------|---------|
| Editing many files in one repo | **Code** |
| Quick question without opening a repo | Desktop **Chat** |
| Plan-only spec | **Plan** mode (desktop or Code composer) |

## Related

- [Modes, skills, and context](../chat/modes-and-skills.md)
- [Troubleshooting](../reference/troubleshooting.md)
