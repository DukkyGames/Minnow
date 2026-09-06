# Issues GitHub auto-sync

Design brief for automatic two-way GitHub sync from Settings → Issues. Confirm before implementation.

## Todos

- [x] Confirm this brief
- [x] Persist **Sync automatically** (`minnow.issues.github.auto`, default off); ignore it when mode is Off
- [x] Settings: checkbox under Two-way mirror; disabled when mode is Off
- [x] On synced-field change (peek, agent/`issue_*`, any `updateIssue`): debounce, then create (unlinked) or `planIssueSync` (linked)
- [x] 5-minute quiet check **while Minnow is running, including background**; poller must **not** create unlinked issues
- [x] Conflicts: skip auto push; peek pane if that issue is open, else toast
- [x] Tests, `documentation/context.md`, Issues manual
- [ ] Verify: Settings toggle, local edit push, agent edit, poller, conflict toast vs pane, background tick in the desktop shell

---

## Agreed context

- **Goal:** With Two-way mirror on, GitHub-synced fields stay current without clicking **Sync** / **Push to GitHub**. Local edits push; remote edits pull; a quiet timer catches drift even when the window is unfocused or minimized.
- **Users & platform:** Same Issues users as today. Desktop shell is the real requirement (packaged Electron already sets `backgroundThrottling: false`). Vite-only browser tabs may still throttle timers; document that, do not invent a second scheduler for the tab.
- **MVP:** One checkbox, change-triggered push/create, 5-minute linked sync, conflict skip + surface. No last-writer-wins.
- **Non-goals:** Backfill every unlinked card the moment Auto turns on. Syncing assignee, priority, type, rank, comments, or attachments. A peek wizard. A connect-GitHub flow. Flipping `localServerAvailable` on GitHub failures (MIN-660).
- **Success:** After Auto is on, editing title/body/labels/closed-status on a card updates GitHub without a click; a GitHub-side edit shows up locally within five minutes (or on the next local sync of that card); both-sides-changed never overwrites; turning Auto off returns to manual Sync/Push.

This **reverses** the previous GitHub UI brief (“we do not poll GitHub”). Polling is now in scope, but only as a quiet 5-minute check, not a live remote-drift badge.

---

## 1. Feature summary

Two-way mirror still requires a click: **Sync** on a linked row, **Push to GitHub** on an unlinked card. Agents and the description editor can change GitHub-shaped fields without anyone touching those buttons, so the remote copy goes stale.

**Sync automatically** (under Two-way mirror) does three things:

1. **Push** a linked issue when its GitHub fields change locally.
2. **Create** on GitHub the first time those fields change on an **unlinked** card *after Auto is already on* (no backfill).
3. **Check GitHub every 5 minutes** for already-linked issues, including while Minnow is in the background, and pull when only the remote moved.

Conflicts stay user-resolved: Keep mine / Keep GitHub in the peek, or a toast if that peek is closed.

---

## 2. Primary user action

Turn Auto on once. Keep working in Issues (or let an agent edit). Trust GitHub to follow, and trust Minnow to pick up GitHub-side edits within five minutes without opening the peek.

---

## 3. Design direction

- **Register:** product. **Color strategy:** Restrained. No new accent, no status stripe, no “live” pulse on the Git row.
- **Scene:** Same peek Git section as today. Auto is a Settings fact, not a peek banner.
- **Anchors:** existing Settings toggle rows (`createSettingsToggleRow`); existing conflict pane; existing Sync/Push buttons (they stay for on-demand).

---

## 4. Scope

- **Fidelity:** production-ready
- **Breadth:** Settings → Apps → Issues → GitHub; a small auto-sync scheduler next to [`issues-github.ts`](../../src/state/issues-github.ts); hooks from issue writes. Peek chrome stays; it may show **Syncing…** the same way a manual sync does.
- **Interactivity:** shipped Settings checkbox + existing conflict UI + one new toast copy
- **Time intent:** ship the full auto loop (push + create-on-change + 5-minute pull), not a push-only first cut

---

## 5. Setting

**Control:** checkbox **Sync automatically**, directly under the Two-way mirror `<select>`.

**Hint:** When Two-way mirror is on, push title, description, labels, and closed-state as they change; create a GitHub issue the first time those fields change on an unlinked card; and check GitHub every 5 minutes, including while Minnow is in the background. Conflicts still wait for you.

**Storage:** `minnow.issues.github.auto` boolean, default `false`. Keep it beside `minnow.issues.github.mode`.

**Gating:** Auto only runs when `getIssuesGithubMode() === 'mirror'` **and** the flag is true. Switching mode to Off leaves the stored checkbox value alone so turning mirror back on restores the preference; the control is **disabled** (still visible) while mode is Off.

**Turning Auto on:** run one linked-only pass immediately (same rules as the 5-minute tick: pull/push/conflict for cards that already have `issue.github`; **do not** create unlinked cards). Then start the timer.

**Turning Auto off:** cancel pending debounces, stop the timer, leave in-flight calls to finish (do not abort mid-`gh`).

---

## 6. What counts as a GitHub field change

GitHub’s snapshot is title, body, open/closed, labels ([`SyncFields`](../../src/issues/github-sync-plan.ts)). Local writes that **do** schedule auto-sync:

- `title`
- `description`
- `labels`
- `status`, **only when** the taxonomy closed-role mapping actually changes GitHub open/closed

Writes that **must not** schedule auto-sync (and must not count as the “first change” that creates an unlinked issue):

- rank, assignee, type, priority, project, parent, comments, attachments, git links, agent slot, view membership, anything else local-only

`updateIssue` always bumps `updatedAt` and emits `issues-change`. Auto must **diff the four synced fields**, not hook every store write.

**Who writes:** peek, list, board, Settings import (already linked), **and** `issue_*` tools / agents. One scheduler, not a peek-only listener.

**New cards:** `addIssue` does **not** create on GitHub. The initial title is the starting state, not a post-enable change. The first later synced-field `updateIssue` after Auto is on creates (unlinked) or pushes (linked). Existing unlinked cards stay local until edited or the user hits **Push to GitHub**.

**Description editor:** commits on blur / Ctrl+Enter / Escape / paste / some inserts, not every keystroke. Still debounce **1.5s per issue** so a burst of tool patches or title+label in one gesture becomes one GitHub call.

Flush pending debounces on peek close and on `beforeunload` so a last edit is not dropped.

---

## 7. Five-minute background check

**Cadence:** 5 minutes, wall clock, while Minnow is running.

**Background:** do **not** pause on `document.hidden` or window blur. The desktop shell already sets `webPreferences.backgroundThrottling: false` in [`electron/main.ts`](../../electron/main.ts), so a renderer `setInterval(5 * 60 * 1000)` keeps firing when minimized. Also run a catch-up pass when Electron broadcasts `minnow:power:screen-unlocked` (sleep/lock) so a long sleep does not wait another full five minutes.

**Do not** add a second main-process GitHub client. The renderer already owns `syncIssueWithGithub` / `syncAllIssuesWithGithub`. The timer only **wakes** that path.

**Poller eligibility (linked only):**

- Auto on, mode mirror
- Local tool server up (same gate as manual sync; if down, skip the tick and do not flip `localServerAvailable`)
- `gh` + GitHub remote available; if not, skip quietly (do not toast every five minutes)

**Poller must skip `planIssueSync` `kind: 'create'`.** Today `syncAllIssuesWithGithub` would create every unlinked card. That is backfill. The 5-minute pass (and the “Auto just turned on” pass) only iterates issues that already have `issue.github`. Unlinked create stays on the change-triggered path and on manual **Push to GitHub**.

**Overlap:** one poller pass at a time. Per-issue: skip or queue if that id is already in flight (manual Sync, debounce flush, or poller). Do not start a second `gh` for the same number.

**Errors:** toast once, then cool down (skip ticks for ~15 minutes on auth/`gh` missing). Same user-facing copy as manual sync, including **Open or restart Minnow** when the backend is down.

**Browser tab:** best-effort `setInterval`. Manual may throttle; that is acceptable. The 5-minute-in-background guarantee is for Minnow Shell.

---

## 8. Conflicts

Planner is unchanged: both sides dirty → `{ kind: 'conflict' }`. Auto **never** picks a side and **never** adds a who-wins branch in [`issues-github.ts`](../../src/state/issues-github.ts).

| Peek for that issue | What happens |
| --- | --- |
| Open | Existing Keep mine / Keep GitHub pane |
| Closed | Toast: **Both sides changed on #n. Open the issue to pick.** |

Do not auto-open the peek. Manual **Sync** still works.

---

## 9. Peek Git row

No new Auto badge. While a scheduled or poller sync is in flight, reuse **Syncing…** / disabled Sync. Caption stays **Needs push** until the watermark updates, then **synced {relative}**. Unlinked + Auto still shows **Push to GitHub** (manual escape hatch; Auto create only after a synced-field change).

---

## 10. Architecture notes

Keep the planner pure. Suggested split:

| Piece | Role |
| --- | --- |
| `get/setIssuesGithubAuto` | persist flag; `githubAutoSyncActive()` = mirror && auto |
| `syncedFieldsChanged(before, after)` | title / description / labels / closed mapping |
| `scheduleIssueGithubAutoSync(issueId)` | 1.5s debounce; create vs `syncIssueWithGithub` |
| `start/stopGithubAutoSyncLoop` | 5-minute linked-only pass + power-unlock catch-up |
| Settings | toggle + enable/disable with mode |

Boot: after `loadIssuesFromStorage()`, if Auto is active, start the loop (do not create unlinked cards on boot).

Workspace: current workspace only (Issues already are).

---

## 11. Key states

| State | Behavior |
| --- | --- |
| Mode Off | Checkbox disabled. No network from Auto even if the stored flag is true. |
| Mirror, Auto off | Today’s manual Sync / Push. |
| Mirror, Auto on, linked, local GitHub fields change | Debounced push. |
| Mirror, Auto on, unlinked, first GitHub-field change | Debounced create. |
| Mirror, Auto on, unlinked, no field change | Stays local. Poller ignores it. |
| Only rank/assignee/etc. change | No schedule. |
| Both sides dirty | Skip write; pane or toast. |
| Auto turned on | Immediate linked-only pass, then 5-minute loop. |
| Window backgrounded | Loop keeps ticking (desktop shell). |
| Backend / `gh` down | Skip; existing error copy; no `localServerAvailable` flip. |

---

## 12. Tests

- Auto flag persists; `githubAutoSyncActive()` is false when mode is Off
- `syncedFieldsChanged` true for title/body/labels/closed-role; false for rank/assignee
- `addIssue` does not create; later title edit does
- Poller / enable-on pass never calls create for unlinked cards
- Debounce coalesces two quick title writes into one sync
- Conflict → no auto write; peek open vs toast
- Planner conflict cases unchanged

---

## 13. Docs (when implementing)

- [`documentation/context.md`](../context.md) GitHub row: Auto checkbox, change-triggered create/push, 5-minute linked poll including background, no unlinked backfill
- [`documentation/manual/apps/issues.md`](../manual/apps/issues.md): what Auto does and that conflicts still need a pick

---

## 14. Confirm before coding

1. **Sync automatically** as the checkbox label (full auto, not “auto-push only”).
2. **1.5s** debounce per issue.
3. **Enable-on** runs one linked-only pass immediately (still no unlinked create).
4. **Checkbox stays checked-but-disabled** when mode is Off (preference remembered).

Say if any of those should change; otherwise this is ready to implement.
