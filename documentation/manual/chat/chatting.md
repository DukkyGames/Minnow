# Working in chat

The basics of chat take one minute. The controls on this page are the ones that make a long agent session survivable: correcting a run without killing it, queueing your next instruction, undoing a turn that touched files, and going back to an answer you liked better.

## The composer

| Control | What it does |
|---------|--------------|
| **Mode strip** | General / Build / Plan / Debug — see [Modes](../concepts/modes.md) |
| **Attach** | Files onto the conversation, 10 MB each |
| **Tools** | Off/Ask/Full for every tool, plus web-search provider and result cache |
| **Microphone** | Dictation — see [Voice](../extend/voice.md) |
| **Model** | Per-chat model. **Ctrl+M** / **Cmd+M** opens it with search focused. |
| **Context ring** | Window usage; click for the breakdown |
| **Send / Stop** | Enter sends; Enter again stops while streaming |

**Enter** sends, **Shift+Enter** adds a line. **↑** with the caret at the start of the composer walks back through your previous prompts, shell-style; **↓** walks forward.

Drafts survive switching chats.

## While the model is working

You do not have to sit still and wait.

**Type your next message and press Enter.** It queues, and runs when the current turn settles. Useful when you already know the follow-up.

**Steer instead, when the run is going wrong.** A correction sent mid-turn is injected at the next tool-loop boundary rather than aborting the stream — so the model gets "actually, use the existing helper" before it writes the next file, without losing the work it has already done. This is almost always better than stopping and re-prompting: stopping throws away the context the model had built up.

**Stop** when the run is genuinely off the rails. The partial reply stays.

## When a turn fails

If a reply errors mid-stream, the partial stays on screen. **Continue** retries with the full conversation still in context. **Clear** removes the failed assistant output and keeps your prompt. Neither control wipes earlier turns.

## Watching what agents do

- **Inference metrics** — tokens, tok/s and totals for the turn. In Code, the strip at the bottom of the chat column.
- **Agent activity** — a panel of what sub-agents are doing right now: thinking, generating, or which tool they are running.
- **Sub-agent cards and drawer** — every spawned agent gets a card in the transcript; open it for the full activity transcript, live.

A background sub-agent that finishes while you are elsewhere pushes its result to the parent conversation, so the model sees it without a wall of text appearing in your transcript.

## Undoing a turn

The **undo** control beside the Code changes strip rewinds the last settled agent turn back to your message. Where Minnow captured a git snapshot around that turn, it restores the working tree too — not just the conversation.

Details worth knowing:

- The file-restoring undo appears **only in a git repository** and **only when that turn actually changed files**. No repository means no snapshot, so there is nothing to restore.
- The message **⋮** menu always offers **Undo turn** for a conversation-only rewind.
- Undo does not auto-regenerate. You get your prompt back and decide what to do.
- The undone reply stays redoable through the branch picker.
- Orchestrate, board-linked and worktree-isolated chats do not support undo; the control is disabled with the reason.

Snapshots are made with dangling commits, so your index, HEAD and branch are never moved. If two chats share one repository, the last restore wins.

## Branches

Regenerating or forking a turn creates a **branch** — a separate continuation from the same point. The branch picker appears on that message and lets you move between them; the branch you leave keeps its follow-up messages, so switching back and forth does not destroy either side.

This is how you try "do it with X" and "do it with Y" without two chats and manual copy-paste.

## Managing conversations

- **New chat** from the rail, or the tray menu.
- **Search** from the rail — full-text over your message history, with **↑ ↓** to move and **Enter** to open.
- **Groups** organise related chats; orchestrate boards appear as folders with their member chats nested.
- Chats belong to a workspace folder, so the rail shows what is relevant to where you are.

There is no fixed limit on how many chats you can keep. Deleting a chat is immediate and confirmed in-app.

Chats with an active `/loop` show a rotating icon in the rail — spinning while a loop is live, still when every loop on that chat is paused.

## Notifications

The menubar bell collects what happened while you were not looking: a chat that finished, a task that needs you, a scheduled job that ran. **Settings → General → Notifications** controls the categories and sounds, including whether cues play while you are already watching the active chat.

## Asking you questions

The model can ask *you* something mid-run with a question card rather than guessing and being wrong. Answer it and the run continues. Skills like `/ask-user` use this deliberately.

## Related

- [Skills and slash commands](skills-and-commands.md)
- [Modes](../concepts/modes.md)
- [Context, memory, and rules](../concepts/context-and-memory.md)
- [Keyboard shortcuts](../reference/keyboard-shortcuts.md)
