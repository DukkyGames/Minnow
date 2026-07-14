---
name: Git Center Lightbox
overview: Centered Source Control Center lightbox with repo topology tree and full git operations.
status: implemented
---

# Source Control Center Lightbox

## Summary

A **centered lightbox** opens from the **Control Center** text button in the git panel toolbar and complements the sidebar Source Control panel (`#btnGitPanelToggle`). It provides multi-worktree navigation via a **repo topology tree** and advanced git operations (merge, rebase, stash, cherry-pick).

## Key files

| File | Purpose |
|------|---------|
| [`src/ui/git-center-lightbox.ts`](../src/ui/git-center-lightbox.ts) | Overlay shell, open/close, layout wiring, focus trap |
| [`src/styles/git-center-lightbox.css`](../src/styles/git-center-lightbox.css) | Lightbox + topology styles |
| [`src/ui/git-repo-topology.ts`](../src/ui/git-repo-topology.ts) | Tree model + left-rail renderer |
| [`src/ui/git-operations-panel.ts`](../src/ui/git-operations-panel.ts) | Shared Changes / History / Branches UI (lightbox tabbed mode) |
| [`src/ui/git-advanced-actions.ts`](../src/ui/git-advanced-actions.ts) | Merge/rebase/stash/cherry-pick dialogs + conflict UI |
| [`server/git/git-ops.js`](../server/git/git-ops.js) | New merge/rebase/stash/cherry-pick ops |
| [`src/state/git-api.ts`](../src/state/git-api.ts) | Client wrappers |

## Server API extensions

| `op` | Notes |
|------|-------|
| `merge` | `branch`, `noFf?`, `abort?` |
| `rebase` | `onto`, `abort?`, `continue?` |
| `stashList` / `stashPush` / `stashPop` / `stashApply` / `stashDrop` | Standard stash workflow |
| `cherryPick` | `sha`, `abort?`, `continue?` |

Conflict failures return `ok: false` with `conflict: true`.

## Implementation phases

- [x] Phase 1 — Shell + topology (lightbox overlay, tree, entry button)
- [x] Phase 2 — Tabbed ops panel in lightbox (Changes | History | Branches)
- [x] Phase 3 — Advanced git APIs + toolbar + dialogs
- [x] Phase 4 — Context menus, tree keyboard nav, reduced-motion, a11y, docs

## Follow-ups

- Extract sidebar [`git-panel.ts`](../src/ui/git-panel.ts) to use `git-operations-panel` in stacked mode (shared module exists; sidebar still inline)
- Optional keyboard shortcut `Ctrl+Shift+G`
