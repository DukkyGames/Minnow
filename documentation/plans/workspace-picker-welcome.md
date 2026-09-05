# Workspace picker (welcome gate)

Redesign `#/workspaces` / `#welcomeView` so recents are folders the user actually opened, Sandbox is a pinned Minnow home, and the screen is a resume list rather than two hero tiles plus a dead "View all".

## Status

Shape brief awaiting confirmation. Do not implement until the brief is approved.

## Todos

- [ ] Stop recording recents except on explicit user open/create/picker/menubar activation (`touchRecentWorkspacePath` call sites)
- [ ] Stop `ensureScratchWorkspaceRegistered` from inserting Scratch into MRU; pin it in the UI instead
- [ ] Prune junk from `workspace.recentPaths` on load (temp dirs, `~/.minnow/worktrees/**`, placeholder install roots)
- [ ] Apply the same filtered list to the welcome page and the workspace menubar
- [ ] Rename user-facing Scratch label to **Sandbox**; reuse the existing Minnow glyph on the pinned row
- [ ] Replace the two hero tiles with compact Open folder / Create project actions; drop View all
- [ ] List-first layout: pinned Sandbox, then the full recents list (storage cap still 10)
- [ ] Quiet row actions: hover/focus on fine pointer; always visible on touch; keep Open / background / missing / Close
- [ ] Tests for membership, prune, Sandbox pin (no remove), View all gone, menubar parity
- [ ] Update `documentation/context.md`, glossary, and other user-facing "Scratch" workspace copy

## Confirmed choices (discovery)

1. Recents membership: only folders the user opened or created through the picker, plus a pinned Sandbox home.
2. Drop "View all". Show the full filtered list on this screen.
3. List-first layout: recents are the primary surface; Open folder and Create project are compact secondary actions.
4. User-facing name: **Sandbox**, with a small Minnow glyph.
5. Placement: pinned row above Recents (same list chrome, cannot be removed).
6. Dirty MRU: prune junk from `config.json` on load so it disappears everywhere.

## 1. Feature summary

This is the first screen of a session: pick the folder root before Code, git, and agents mean anything. It is for a developer who already knows which repo they want, sitting down at a monitor with Minnow open, impatient to start.

Success is a short, truthful list of folders they opened themselves, a clear way to open or create one, and a named Sandbox when they have no project.

## 2. Primary user action

Resume a folder they already opened. Opening or creating a folder is the fallback, not the hero.

## 3. Design direction

- **Register:** product. **Color strategy:** Restrained (project default). Accent on focus, the stronger Open folder control, and selection. Not on the Sandbox row as a colored card.
- **Scene:** A developer sits down at a desk monitor, Minnow already running from last night, and needs to land in the right repo before anything else loads. The room is dim; they are impatient to start, not to browse. That forces the app theme (default swamp-dark) rather than a special welcome palette.
- **Anchors:** VS Code empty window (recents as the resume path), Linear (compact actions, pinned vs list), Finder sidebar (pinned home vs Recents).
- **Anti-goals:** identical Open/Create card grid; dead View all; worktrees and temp dirs posing as projects; glass, gradient text, side-stripe accents.

## 4. Scope

Production-ready. One screen (the workspace gate) plus the shared recents membership that also feeds the workspace menubar. Shipped-quality. Polish until it ships.

Internal identifiers (`isScratchWorkspacePath`, `scratchPath`) can stay. User-facing "Scratch" as a workspace name becomes Sandbox.

## 5. Layout strategy

Left-aligned work column (keep ~720px max). Not a centered marketing welcome.

1. Title: "Choose a workspace".
2. Compact action row: **Open folder** (slightly stronger) and **Create project** (quieter). Text plus small icon, not equal tiles.
3. Pinned **Sandbox** row: Minnow glyph (`minnow-glyph`, currentColor, ~18px), label Sandbox, hint "Minnow's folder when you don't have a project." Path lives in the tooltip, not as the subtitle. No Remove.
4. Recents heading. No count link. Full filtered list underneath.
5. Create-project panel still expands in place under the action row (same flow as today).

Rhythm: more air in the list than today's dense table. Folder name is the row; path is a muted mono caption with ellipsis and a full-path tooltip.

## 6. Key states

| State | What the user sees |
| --- | --- |
| Default | Sandbox pinned, recents of real opens, compact Open / Create |
| Empty recents | Sandbox still there. Copy: "Open a folder to see it here." |
| Missing folder | Dimmed name + path, Remove only, not clickable to open |
| Open in a window | Quiet "Open" label; trailing action becomes Focus |
| Backgrounded | Quiet "Running in background"; trailing action becomes Show; Close still available |
| Server down | Existing banner; Open / Create disabled |
| Create flow | Action row gives way to the name field + parent hint |
| First run | Sandbox + empty recents. No junk from tests or worktrees |

## 7. Interaction model

- Click a live recent: switch this window, or focus the window already on that folder.
- Click Sandbox: same activation path as a recent.
- Hover / focus (fine pointer): reveal New window (or Focus / Show), Close if open, Remove. Coarse pointer: those actions stay visible.
- Remove: drops the path from MRU only. Cannot remove Sandbox.
- Keyboard: native tab order through actions, Sandbox, then rows. Visible focus rings. No custom listbox.
- Drop "View all" entirely.

## 8. Content requirements

- Title: Choose a workspace
- Open folder / Browse to an existing folder on disk (keep; can shorten the hint if it fights the compact control)
- Create project / New folder under Projects
- Pinned label: Sandbox
- Pinned hint: Minnow's folder when you don't have a project
- Recents heading: Recent workspaces
- Empty: Open a folder to see it here.
- Badges: Open, Running in background
- Trailing: New window, Focus, Show, Close, Remove
- No timestamps, no git branch, no search (cap remains 10 stored recents)

Realistic range: 0 recents (plus Sandbox) typical 2–5, max 10.

## 9. Recents membership (behavior, not chrome)

Record a path only when the user opens, creates, or picks a folder (welcome, folder picker, menubar, Electron open-workspace from that UI).

Do not record: git worktrees, `~/.minnow/worktrees/**`, agent/test cwds, temp dirs, placeholder install roots, Sandbox via `ensureScratchWorkspaceRegistered`.

On load, prune those junk paths from `workspace.recentPaths` so the menubar stays clean too. Sandbox is pinned in the UI and should not occupy an MRU slot.

## 10. Recommended references

`reference/layout.md`, `reference/onboard.md`, `reference/clarify.md`, `reference/product.md`.

## Open questions

None. Remaining calls: left-align the column; hide Sandbox's filesystem path in the row (tooltip only); no recents search or timestamps.
