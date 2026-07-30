# Your first chat

The **Chat** surface is the Minnow desktop: the place you land after launch. Everything else opens from the dock as a full app, window, or side panel while chat stays available on the desktop layout.

## Desktop layout

| Area | What it does |
|------|----------------|
| **Dock** | Launch Code, Research, Models, Brain, Issues, Scheduler, Settings, and return to Chat. |
| **Menubar** | Model chip, notifications, clock, help (**?**), and settings shortcuts. |
| **Chat rail** (left) | Switch sessions, search chats, start new conversations. |
| **Composer** (bottom) | Type messages, pick mode, attach files, send or stop generation. |

The desktop also runs a **smart concierge** on send: one structured routing step tries to open the right app and seed context (with keyword fallback if the model is offline).

## Composer basics

1. Click in the composer and type a short message, for example: "What can Minnow do on my machine?"
2. Press **Enter** to send. **Shift+Enter** adds a new line without sending.
3. While the assistant streams, **Enter** again acts as **Stop** when the send button is in stop mode.
4. Open the **per-chat model picker** with **Ctrl+M** (**Cmd+M** on macOS) to change model for this chat.

### Tool approval

When the model wants to run a tool and permission is **ask**, a strip appears with choices. Press **1** (allow once), **2** (always allow), or **3** (cancel). Digit shortcuts work when you are not typing in another field.

## Modes in the composer strip

Four modes appear in the composer. Each changes the system behavior and which tools are allowed.

| Mode | Use when |
|------|-----------|
| **General** | Everyday questions, brainstorming, and mixed tasks with normal tool approval. |
| **Build** | Default development work: files, git, terminal, and broad tool access. |
| **Plan** | Planning and analysis without destructive changes (no shell writes, file deletes, git mutations, and similar). |
| **Debug** | Investigating bugs and filing work in **Issues**. |

Modes not in the strip (Orchestrate boards, Super Plan, onboarding) open from other parts of the UI. See [Modes, skills, and context](../chat/modes-and-skills.md).

Pick a mode before you send if the task needs a strict policy (for example **Plan** for "design only, do not edit files").

## Context ring

Beside **Send**, the **context ring** shows how much of the model context window your conversation is using. If no limit appears, the loaded model did not report a `context_length`. Very long chats or big attachments push usage up; trim history or switch to a larger-context model if replies degrade.

## Attachments and workspace

- Drag files into the composer, or use the attachment control beside it.
- For code tasks, open **Code**, choose a **workspace folder**, then chat in Build mode so file and git tools resolve under that project.

## Slash skills

Type **/** at the start of the composer to open the **skill picker**. Skills are packaged prompts (for example code review or git commit helpers). Choose one, then continue your message. Fifteen skills ship built in and are on by default; install more from **Settings → Tools & integrations → Skills Library**.

## Open another app

Click **Code** in the dock to edit files beside chat, or **Research** for multi-step web research. The concierge may suggest an app after you send from the desktop composer.

## Next steps

- [Modes, skills, and context](../chat/modes-and-skills.md)
- [Apps overview](../apps/overview.md)
- [Keyboard shortcuts](../reference/keyboard-shortcuts.md)
