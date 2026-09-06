# Issues GitHub sync UI

Design brief for unifying GitHub sync with the Issues peek Git section. Confirm before implementation.

## Todos

- [x] Confirm this brief
- [x] Drop **Link + push**; migrate stored `link` → `off`; Settings is Off | Two-way mirror
- [x] Merge GitHub sync into the Git peek section; remove the duplicate GITHUB block and GH-issue chip
- [x] Linked row: `#5 · synced 2h ago` or `#5 · Needs push`; Open uses the system browser
- [x] Unlinked + mode on: **Push to GitHub** in the Git toolbar; mode off: hide Push
- [x] Rewrite Settings → Issues → GitHub copy; make Import a first-class action
- [x] Tests, `documentation/context.md`, Issues manual
- [x] Browser-verify peek states and Settings

---

## 1. Feature summary

Issues peek currently shows the same GitHub issue twice: a **GitHub** block (`Linked to #5.`, `#5 · github`, checkbox, Sync now) and a **Git** chip (`GH issue: #5` + Open on GitHub). Sync already writes that chip, so they stay duplicated. The GitHub block’s `#5 · github` link is a plain `<a target="_blank">`, which can open inside Electron; the Git chip already uses `openExternal`.

This pass makes **one Git section** the home for GitHub identity, last-sync status, push/sync, and the existing branch / PR / commit tools. Settings drops **Link + push**. Workspaces already on that mode become **Off** so nothing syncs until the user picks Two-way mirror.

## 2. Primary user action

Glance at the Git row, know which GitHub issue this is and whether the local card needs a push, then either open it in the **system browser** or sync.

## 3. Design direction

- **Register:** product. **Color strategy:** Restrained (project default). Accent on the issue number link and primary sync/push action only.
- **Scene:** A developer at the desk, Issues peek beside the editor, checking whether this card is on GitHub before they keep building. Same Minnow palette family as the rest of the shell (default swamp-dark). Mood is checking a fact, not configuring GitHub.
- **Anchors:** Linear’s issue peek git/link row; `gh issue view` terse status; Source Control Center’s ghost **Open on GitHub** (already in this app).
- **Visual probes:** skipped. Refinement of an existing peek section, not a new surface.

## 4. Scope

- **Fidelity:** production-ready
- **Breadth:** Issues peek Git section + Settings → Apps → Issues → GitHub. Not list/board row chrome, not a GitHub connect wizard.
- **Interactivity:** shipped controls, including conflict columns that already exist
- **Time intent:** polish until it ships, including the mode drop and migration

## 5. Layout strategy

One section, heading **Git**.

1. **Toolbar** (existing Create branch / Create PR / Review PR / Link…): add **Push to GitHub** only when Settings mode is Two-way mirror and this card has no `issue.github`. Hide Push when mode is Off.
2. **List:** if linked, the first row is the GitHub issue: mono `#5`, muted `· synced 2h ago` or `· Needs push`, then **Open** (system browser) and **Sync**. Do not also render a `gitLinks` chip of kind `github-issue` for the same number.
3. **Then** PR, branch, other git chips, commits, and the existing Link… fields.
4. **Conflict** (mirror, both sides changed): keep the two-column Keep mine / Keep GitHub pane **under that row**, not a modal and not a wizard.

Drop the separate `GITHUB` heading, the “Linked to #5.” sentence, the `#5 · github` `<a>`, and the “Sync this issue” checkbox.

Empty Git (no links, mode Off): keep today’s compact untitled add-row. Empty Git but mode On: show the **Git** heading so Push has a home.

## 6. Key states

| State | User sees |
| --- | --- |
| Mode Off, unlinked | Git tools only. No Push, no GitHub copy. |
| Mode Off, leftover `issue.github` | `#5 ·` last sync time (or the number alone if no watermark). **Open** in the system browser. No Sync, no Push. |
| Mode On, unlinked | **Push to GitHub** in the toolbar. No empty-state lecture. |
| Mode On, linked, local unchanged since watermark | `#5 · synced 2h ago` + Open + Sync |
| Mode On, linked, local `updatedAt` after watermark | `#5 · Needs push` + Open + Sync |
| Sync in flight | Sync/Push disabled, label **Syncing…** |
| Already in sync | Toast (existing), row returns to `synced … ago` |
| Conflict | Two columns, Keep mine / Keep GitHub. Nothing overwritten until they pick. |
| Error | Existing toast / git error line. Settings import still uses **Open or restart Minnow** when the backend is down (MIN-660). |
| No `gh` / no GitHub remote | Existing failure copy. Do not invent a connect wizard in the peek. |

Remote drift is **not** shown until Sync runs. We do not poll GitHub.

## 7. Interaction model

- **Open:** always `openExternal` (Electron `shell.openExternal`, else `window.open`). Never the in-app browser.
- **Sync:** one click, same `syncIssueWithGithub` path. Mirror only (Link + push is gone).
- **Push to GitHub:** same API, create-on-remote path, from the toolbar.
- **Needs push:** local `updatedAt` after `github.localUpdatedAt` (fallback `github.syncedAt`). No network.
- **Checkbox / `githubSync`:** removed from UI. Field may remain on disk; peek and Settings stop reading it.
- **Migration:** on read, stored mode `link` becomes `off` and is persisted so it does not bounce. Existing linked numbers stay on the card; they just stop syncing until the user chooses Two-way mirror.

## 8. Content requirements

**Peek**

- Linked in sync: `#5 · synced {relative time}`
- Linked dirty: `#5 · Needs push`
- Open control: **Open** (title: Open on GitHub)
- Sync control: **Sync** (loading: **Syncing…**)
- Unlinked, mode on: **Push to GitHub**
- Conflict head (keep, tighten if needed): both sides changed since the last sync. Pick which to keep.

**Settings → Issues → GitHub**

- Keep names **Off** and **Two-way mirror**. Drop **Link + push** from the control.
- Hint Off: Nothing is sent to or read from GitHub.
- Hint Two-way mirror: Issues sync both ways. When both sides changed, you pick which to keep.
- **Import issues from GitHub** is a full settings action (label + short result), not a leftover under the hint.
- Do not add a fourth mode.

## 9. Recommended references

- `spatial-design.md` (peek density, one list)
- `typography.md` (mono number, muted status)
- `ux-writing.md` (Settings hints, Needs push)
- `interaction-design.md` (toolbar vs row actions, loading)

## 10. Open questions (implementer)

- Reuse an existing relative-time helper vs a tiny local formatter next to other Issues timestamps.
- A pasted `github-issue` git link whose number is **not** `issue.github.number` still renders as a normal chip.
- `githubSync` stays in the schema for old files; no UI writes it.

## Anti-goals

- No connect-GitHub wizard, onboarding, or “connect GitHub” empty state in the peek.
- No nested cards, badge stacks, or colored side stripes.
- Do not poll GitHub for remote status.

## Image gate

Skipped: existing-surface refinement; probes would not clarify the brief.
