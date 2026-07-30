# Issues app

Use **Issues** for lightweight issue tracking inside Minnow: list and board views, quick capture, and agent-driven triage in **Debug** mode.

## Open Issues

Click **Issues** in the dock. The app opens **fullscreen** like Code.

## Views

| View | Best for |
|------|----------|
| **List** | Scanning titles, status, and priority in a table |
| **Board** | Kanban columns by status |

Switch views from the Issues header controls.

## Capture and edit

- Use **quick capture** to file a new issue with minimal friction.
- Open an issue to edit title, description, status, priority, and labels.
- **Ctrl+Enter** / **Cmd+Enter** saves description edits; **Escape** cancels.

Multi-select: **Ctrl+click** toggles rows; **Shift+click** range-selects. **Shift+F10** or context menu opens row actions.

## Taxonomy

Configure statuses, priorities, and labels under **Settings → Apps → Issues**. Keep the taxonomy simple so agents and humans share the same vocabulary.

## Debug mode and agents

Set composer mode to **Debug** when you want the model to investigate and file issues with **issue_*** tools. Approve tool calls when permissions are **ask**.

Issues replaced the older separate bug tracker: one surface for bugs and tasks you want the agent to own.

## Related

- [Modes, skills, and context](../chat/modes-and-skills.md)
- [Code app](code.md) for fixing what you file
