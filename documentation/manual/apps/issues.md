# Issues

A tracker that agents can use. Issues is a Linear-style list and board for work in your workspace, with the difference that the assistant can file, triage, expand and close items through tools — so "I found three problems while reading this" becomes three real cards instead of a paragraph you will lose.

Open it from the app rail for the fullscreen app, or from the Issues button in the Code sidebar rail to embed it beside your code.

## Views

- **List** — one dense row per issue, grouped (status by default). Click a column header to sort inside a group when ranks are equal or missing; drag or **Alt+↑/↓** writes a manual rank that then sticks. Click a status, priority, assignee, or project cell to edit it in place.
- **Board** — kanban lanes by status. Drop a card to change status and rank; a line shows the insert point. **Shift+←/→** moves the focused card across columns.
- **Triage** — a saved view of issues that arrived from an agent, a crash, or GitHub and have not been reviewed yet. **Y** accepts (backlog), **N** or **Backspace** declines (canceled).
- **Assigned to agents** / **My open** — the other built-in tabs. Hide-done is a chip under the tabs.

## Working with issues

**Capture** with the quick-capture field in the header, or **New issue** (**C**) for the full form. When **Workspace scope** is **All workspaces**, the new-issue form includes a **Workspace** picker (Scratch plus recent folders). New issues start in **Backlog**.

**Select** several rows with **Ctrl/Cmd+click**, or a range with **Shift+click**. The selection bar can change status, priority, assignee, labels, and project, or delete. **Shift+F10** or right-click opens the row menu: open, copy ID, expand (fill title and description from this card), expand with an agent (triage), send to chat or to a background agent, change status, delete.

**j** / **k** (or the arrows) move the focused row. **Enter** opens the peek panel for the description and history — you do not need peek to change a field.

**Edit** labels inline on the row: up to three chips stay visible, a caret opens the rest, and **+** adds a name. The chip **×** removes it from that issue. Right-click a chip to pick a color; that color applies to every issue with the same name.

The peek keeps identity, type/status/priority chips, labels, and Send to chat pinned. The description is the page. Empty code links, attachments, and git collapse to one add row each; Plan and Related appear only when they have something to show. Delete lives under the more menu next to Close.

Type in the description to edit it. The formatting toolbar appears while the description is focused. **Ctrl/Cmd+Enter** commits; **Escape** commits and lets the panel close.

**Projects** group and filter issues inside this app. They are not Orchestrator boards. The Group control can bucket the list by project, and each project shows a closed/open count.

Agents can link related, blocking, duplicate, or parent/sub issues with `issue_link`; those links appear under **Related issues** in the detail panel.

## Handing an issue to an agent

This is what the app is for.

| Action | What happens |
|--------|--------------|
| **Expand** | Sparkles on peek, board cards, the row menu, or **E**. Rewrites the title and description from what is already on the card. You review and edit in an overlay; nothing is saved until you apply. Uses the prompt expander model when one is set. |
| **Expand with agent** | An agent researches the workspace and fills in a real description (triage notes), from the detail panel or the row menu |
| **Send to chat** | Opens a chat seeded with the issue, in a mode you choose |
| **Send to background** | Runs it as a background sub-agent instead of taking over your screen |
| **Send to board** | When the issue has a plan, hands it to an orchestrate board |
| **Open plan** | Opens the issue's plan document in the editor |

Activity chips in the detail header — **Investigating…**, **Planning…** — are live, and clicking one opens the agent drawer or board chat behind it.

**General**, **Build**, **Plan**, and **Debug** all expose `issue_*` tools. Debug also has local diagnostics. Plan can file, update, and attach a plan path to a card; it still cannot edit application code.

## Git conventions

Issues have workspace-specific ids like `MIN-12` (configure the prefix under **Settings → Apps → Issues → Issue IDs**). Legacy `ISS-*` ids still work. Minnow uses the id on each card consistently:

- Branch: `issue/<id>-<slug>` (slug derived from title)
- Commits are found by searching for `[MIN-12]` (or your key)
- Plans live at `documentation/plans/issues/<id>.md`
- Pull requests go through the `gh` CLI when it is installed, with GitHub links appearing on the issue
- **Review PR** (when `gh` is available and a PR can be resolved) runs an in-app reviewer and shows the verdict on the issue. Reviews are not posted to GitHub.
- **GitHub sync** (Settings → Apps → Issues → GitHub) is **Off** or **Two-way mirror**. When it is on, the Issues header shows **Sync all** to push unlinked cards and sync linked issues in one pass — scoped to the **Workspace scope** control (current workspace vs all workspaces). The peek Git section can also push a new issue, sync a linked one, and import open GitHub issues into Triage. **Sync automatically** (under Two-way mirror) pushes title, description, labels, and closed-state as they change, creates a GitHub issue the first time those fields change on an unlinked card, and checks GitHub every 5 minutes while Minnow is running — including in the background. It does not backfill every unlinked card when you turn it on. Labels sync **by name**; if a name is not in the GitHub repo yet, Minnow creates it. Chip colors stay in Minnow. **Open** uses your system browser, not the in-app browser. If both sides changed since the last sync, you pick which to keep (or get a toast if that issue is not open).

When a board finishes work on an issue, the issue moves to **review** rather than closing itself.

## Taxonomy

**Settings → Apps → Issues** defines your **project key** (new auto-ids) and your types, statuses and priorities.

Statuses carry semantic roles and flags — which lanes appear on the board, which count as closed — so workflows can resolve "the triage status" without hard-coding your names. You can delete an entry only when nothing references it.

Keep the taxonomy small. Humans and agents share this vocabulary, and every extra status is another thing for both to get wrong.

## Automatic bug filing

**Settings → Advanced → Health & diagnostics → File renderer errors to Issues** turns uncaught interface errors into bug cards automatically. It is **off** by default. Errors are logged locally and visible in the diagnostics viewer either way.

## Related

- [Modes](../concepts/modes.md)
- [Code app](code.md)
- [Orchestrate boards](../orchestrate/boards.md)
