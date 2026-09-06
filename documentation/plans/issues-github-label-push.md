# GitHub issue label push

Bug: Minnow labels do not land on GitHub when you set a label and push/sync.

## Todos

- [x] Confirm the failure: push `issueEdit` omits labels; create drops names missing from the repo
- [x] Diff local vs remote labels and send `--add-label` / `--remove-label` on push and Keep mine
- [x] Create missing GitHub repo labels (name only) before create/edit; keep `droppedLabels` as last resort
- [x] `updateIssue({ labels: [] })` must clear labels so a full remove can sync
- [x] Tests for the diff, forge helpers, and `syncIssueWithGithub` payloads
- [x] Update `documentation/context.md` and the Issues manual

## 1. Feature summary

Two-way mirror already treats labels as a synced field. The planner includes them; the executor did not. Linked-issue **Sync** / **Push** only sent title and body. First-time create sent `--label`, then retried without labels if the name was not in the GitHub repo catalog.

This pass sends the label set on every push and creates missing repo labels by name so a Minnow-only chip actually appears on GitHub.

## 2. What was broken

1. `runIssueSync` `push` and Keep mine called `issueEdit` with `title` and `body` only. `addLabels` / `removeLabels` were never set.
2. `gh issue create --label X` / `gh issue edit --add-label X` fail when `X` is not a repo label. Create swallowed that by retrying without labels (`droppedLabels`).
3. `updateIssue` treated `labels: []` as "leave unchanged", so removing the last chip could not persist or sync.

## 3. Design

- **Names only.** No color sync (same as the labels brief). New GitHub labels use a neutral default color.
- **Set replace via diff.** GitHub has no replace-all; compute add/remove case-insensitively, remove using the remote's casing.
- **Create if missing.** `gh label create` before attaching. If the repo forbids creating labels, keep today's fallback: save the issue, toast that some labels were dropped.
- **Last resort only.** Do not drop labels when they already exist on GitHub.

## 4. Out of scope

- Syncing Minnow swatches to GitHub label colors
- A Labels settings page
- Assignee / type / priority on GitHub
