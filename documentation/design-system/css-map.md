# CSS file map

96 stylesheets under [`src/styles/`](../../src/styles/). Grouped by surface for audits and scoped Impeccable passes.

## Core / global

| File | Paired logic |
|------|--------------|
| `tokens.css` | Theme engine |
| `global.css` | App-wide reset, icons, focus |
| `fonts.css`, `font-presets.css` | Typography loading |
| `motion.css` | Shared animations |
| `theme-transitions.css` | Theme switch guard |
| `responsive.css` | Breakpoint overrides |
| `minnowos-tokens.css` | OS aliases |

## Chat shell

| File | Paired logic |
|------|--------------|
| `topbar.css` | Top bar, `.icon-btn` |
| `sidebar.css` | [`sidebar.ts`](../../src/ui/sidebar.ts) |
| `input.css` | [`input.ts`](../../src/ui/input.ts) |
| `composer-controls.css` | Composer toolbar |
| `composer-model-trigger.css` | Model chip |
| `composer-pinned-skill.css` | Pinned slash skill |
| `composer-message-queue.css` | Queued messages |
| `composer-tools-popover.css` | Tool picker |
| `mode-selector.css` | [`mode-selector.ts`](../../src/ui/mode-selector.ts) |
| `mode-icons.css` | Mode masks |
| `context-usage.css` | Context ring |
| `messages.css` | [`messages.ts`](../../src/ui/messages.ts) |
| `message-actions.css` | Per-message actions |
| `stats.css` | [`stats.ts`](../../src/ui/stats.ts) |
| `thoughts.css` | Thinking bubbles |
| `tool-call-diff.css` | Tool diff panels |
| `skill-picker.css` | [`skill-picker.ts`](../../src/ui/skill-picker.ts) |
| `chat-search.css` | Chat search popover |
| `chat-app.css` | Chat transcript + composer container (mounted inside Code) |
| `toast.css` | [`toast.ts`](../../src/ui/toast.ts) |
| `voice.css` | Voice controls |

## Settings

| File | Paired logic |
|------|--------------|
| `settings.css` | Legacy settings drawer |
| `settings-page.css` | [`settings-page.ts`](../../src/ui/settings-page.ts) |
| `settings-controls.css` | [`settings-controls.ts`](../../src/ui/settings-controls.ts) |
| `settings-appearance.css` | Appearance editor |
| `settings-agent-center.css` | Agent center |
| `settings-about.css` | About section |
| `settings-updates.css` | [`settings-updates.ts`](../../src/ui/settings-updates.ts) |

## Code workspace

| File | Paired logic |
|------|--------------|
| `file-panel.css` | File tree + editor |
| `terminal.css` | xterm panel |
| `git-panel.css` | Git sidebar |
| `git-commit-diff.css` | Commit diff |
| `git-no-repo.css` | Empty git state |
| `git-help-lightbox.css`, `git-center-lightbox.css` | Git modals |
| `editor-quick-edit.css` | Inline AI edit |
| `editor-intent-mode.css` | Intent mode overlay |
| `code-ref-link.css` | File reference links |
| `code-change-strip.css` | Unsaved changes |
| `code-overview.css`, `code-brain-map.css` | Code overview |
| `preview-panel.css` | Live preview |
| `branch-picker.css` | [`branch-picker.ts`](../../src/ui/branch-picker.ts) |

## Apps

| File | App |
|------|-----|
| `benchmark-page.css` | Bench |
| `compare.css` | Compare |
| `models-page.css` | Models |
| `research-page.css`, `research-library-window.css`, `research-activity.css` | Research |
| `brain-page.css`, `brain-graph.css` | Brain |
| `email.css` | Email |
| `calendar.css`, `calendar-window.css` | Calendar |
| `scheduler-page.css`, `scheduler-side-panel.css`, `scheduler-editor-window.css` | Scheduler |
| `experts-hub.css`, `experts-summon.css` | Experts |
| `issues.css` | Issues app (list/board/detail) |

## Orchestrate

| File | Paired logic |
|------|--------------|
| `orchestrate-board.css` | [`orchestrate-board.ts`](../../src/ui/orchestrate-board.ts) |
| `orchestrate-hub.css` | [`orchestrate-hub.ts`](../../src/ui/orchestrate-hub.ts) |
| `orchestrate-plan-screen.css` | Plan screen |
| `orchestrate-plan-selector.css` | Plan picker |
| `plan-progress.css` | Plan progress |
| `hub.css` | Mode hub |
| `sub-agent-drawer.css` | Sub-agent drawer |
| `agent-activity-panel.css` | Agent activity |

## Minnow

| File | Scope |
|------|-------|
| `minnowos-shell.css` | Menubar, stage chrome, app rail |
| `minnowos-rail.css` | App rail |
| `workspace-gate.css` | Workspaces picker |
| `minnowos-wallpaper.css` | Wallpapers |
| `minnowos-apps.css` | Full-stage app shells |
| `update-menubar.css` | Update pill |

## Misc

| File | Use |
|------|-----|
| `onboarding.css` | First-run |
| `workspace-welcome-page.css` | Workspace welcome |
| `workspace-folder-picker.css` | Folder picker |
| `workspace-menu.css` | Workspace menu |
| `model-select.css` | Model picker dropdown |
| `view-mode-toggle.css` | Chat ↔ board |
| `tool-approval.css` | Permission modals |
| `question-cards.css` | Ask-user cards |
| `design-mode.css` | Preview design strip |

## Legacy fallbacks

Some files still use `var(--mn-fg, var(--text))` during migration:

- `onboarding.css`
- `orchestrate-board.css`

Prefer `--mn-*` only in new rules.
