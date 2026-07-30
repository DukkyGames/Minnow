# Modes, skills, and context

Minnow separates **how the assistant behaves** (modes), **how you invoke packaged workflows** (slash skills), and **how much room is left in the model window** (context ring).

## Composer modes (four in the strip)

| Mode | Behavior |
|------|----------|
| **General** | Balanced assistant for Q&A and mixed tasks. Enabled tools run with your permission settings. |
| **Build** | Primary coding mode. File, git, terminal, LSP, and agent tools are available subject to per-tool permissions. |
| **Plan** | Read and analyze without destructive edits. Mutating file and git operations are denied; the one exception is writing markdown plans under `documentation/plans/`. |
| **Debug** | Investigation and triage. Pairs with the **Issues** app and issue-related agent tools. |

### Modes you enter elsewhere

These do not appear in the composer mode strip:

| Mode | How you open it |
|------|-----------------|
| **Orchestrate** | Orchestrate hub from the sidebar or top bar: kanban boards, waves, Builder and Tester agents. |
| **Super Plan** | Sub-menu under **Plan** in the composer, or the Orchestrate plan screen. Deep interview-to-spec workflow without shipping code in that path. |
| **Desktop** | The default desktop chat surface (same shell as Chat). |
| **Onboarding** | First-run guide chat only. |

Choose the strip mode that matches risk: **Plan** for specs, **Build** for implementation, **Debug** for bugs, **General** for everything else.

## Slash skills

Skills are **SKILL.md** instructions the model follows when you invoke them from the composer.

### Invoke a skill

1. Focus the composer.
2. Type **/** at the start of an empty composer.
3. Use arrow keys, **Enter**, or **Tab** to pick a skill.
4. Add your request after the skill name if needed, then send.

### Built-in skills (15)

All fifteen are enabled by default:

`ask-user` · `browser-automation` · `caveman` · `code-review` · `debug-error` · `docs-update` · `explain-code` · `git-setup` · `git-commit` · `impeccable` · `partymode` · `refactor-safe` · `security-review` · `ui-designer` · `write-tests`

Disable any of them in **Settings → Tools & integrations → Skills**; only enabled skills appear in the picker.

### Install more

Open **Settings → Tools & integrations → Skills Library**. Browse curated packs (for example Matt Pocock, Superpowers) and install individual skills. Installs land in `skills/` under your Minnow home and can be toggled alongside the built-ins.

### Custom skills

Create a folder containing a `SKILL.md` file in `skills/` under your Minnow home, then enable it in the Skills catalog.

### Other slash commands

Three built-in commands are not skills. They appear in the same picker but change chat state rather than adding instructions:

| Command | What it does |
|---------|--------------|
| **/goal** | Set a completion condition; a verifier agent runs tests and checks the code before confirming it is met |
| **/goal clear** | Stop the active goal loop |
| **/loop** | Re-run a prompt on an interval (`/loop 5m …`) or self-paced; bare **/loop** reads `.minnow/loop.md` |

## Context ring

The ring next to **Send** estimates token usage against the active model context limit.

| Signal | Meaning |
|--------|---------|
| Ring fills | Conversation, system prompt, tools, and attachments consume context. |
| No visible cap | Model metadata did not include context length. |
| Sudden quality drop | Context may be full; shorten the chat, remove large attachments, or use a larger model. |

The ring is a guide, not a hard block. Some providers still truncate or fail on overflow.

## When to use what

| Goal | Start here |
|------|------------|
| Quick question | Desktop chat, **General**, menubar model chip. |
| Implement a feature | **Code** app, **Build** mode, workspace folder set. |
| Write a spec only | **Plan** or **Super Plan**, no Code edits expected. |
| Run a delivery board | **Orchestrate** hub, not the composer mode picker. |
| Deep web report | **Research** app or Research-oriented chat. |
| Remember a decision | **Brain** app or `save_memory` from chat (enabled by default). |
| File a bug | **Debug** mode and **Issues** app. |
| Repeat a prompt on a schedule | **Scheduler** side panel (while Minnow is open). |
| Style or review pass | Slash skill (**/code-review**, **/impeccable**, etc.). |

## Related pages

- [Apps overview](../apps/overview.md)
- [Settings app](../apps/settings.md)
- [Wiki and Brain](../reference/wiki-and-brain.md)
