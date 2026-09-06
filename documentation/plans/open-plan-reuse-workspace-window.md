# Open plan should reuse the existing workspace window

## Problem

Clicking **Open plan** on an issue opens a second Electron window for a folder that is already open.

Fullscreen Issues is still the same shell window as Code. **Open plan** calls `launchApp('code', { workspacePath })`, which runs `applyCodeLaunchOptions` → `executeWorkspaceSwitch` → `switchWorkspace` (retarget). Retarget **always** builds a replacement window. When this window already owns that folder (or the path only differs by slashes/casing), that looks like “the workspace opened in another window”.

Issue `workspacePath` is stored normalized (`C:/Users/...`). `getWorkspacePath()` is the OS path (`C:\Users\...`). Raw `!==` treats them as different.

## Decisions

- A folder still opens in **exactly one** view. Opening it again focuses that view; it must not spawn a replacement.
- Compare folders with `normalizeWorkspacePath`, and prefer `viewContext.workspacePath` when the window is bound.
- An unbound gate window is never “already on” a folder (so picking still retargets).
- If another window already has the folder, **Open plan** focuses it (`openWorkspace`) instead of retargeting this one.

## Todos

- [x] `ShellWindowRegistry.isWindowOnWorkspace` + `retargetShellWindow` no-op
- [x] `isCurrentWindowWorkspace` + skip switch in `executeWorkspaceSwitch` / `applyCodeLaunchOptions`
- [x] `openIssuePlanInEditor` focuses an existing window; omit `workspacePath` when already here
- [x] Tests: trailing-slash launch, registry already-on-folder, switch skip
- [x] Update `documentation/context.md`

## Test plan

- [ ] Fullscreen Issues → Open plan on an issue in the current workspace: same window, plan opens in the viewer
- [ ] Open plan when that folder is already open in another window: that window focuses; no third window
- [ ] Workspace gate still binds the first picked folder (no false “already here”)
