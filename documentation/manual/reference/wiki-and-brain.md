# Wiki and Brain

Minnow gives you two different documentation surfaces. They are easy to confuse because both can answer questions, but only one is yours to edit.

## Minnow wiki (official help)

| | |
|---|---|
| **Open** | Menubar **?** button |
| **Content** | User manual for your installed version (install, apps, modes, troubleshooting) |
| **Editable** | No at runtime (pages ship with the build) |
| **Search** | Sidebar sections plus top search; **Ctrl+K** / **Cmd+K** inside the wiki |
| **Deep links** | Address bar hash reloads the same page |

Use the wiki to learn how Minnow works: install, apps, modes, shortcuts, troubleshooting, roadmap.

Developer setup, architecture, and contributor docs are on the [GitHub Wiki](https://github.com/DukkyGames/Minnow/wiki), not in the in-app reader.

## Brain (your knowledge)

| | |
|---|---|
| **Open** | **Brain** app in the dock |
| **Content** | Your facts, decisions, specs, meeting notes, code index |
| **Editable** | Yes |
| **Storage** | Minnow home `brain/` folder |
| **Agent tools** | Search, read, write pages, memory, ingest, code symbols |

Use Brain for project context the assistant should remember across chats.

## Ask chat about Minnow itself

In **General** mode (and onboarding), the model can call read-only **minnow_docs_*** tools:

| Tool | Purpose |
|------|---------|
| Search | Find official pages and excerpts |
| Read | Open a page from search results |
| List | Browse the documentation catalog |

For "How do I set up Ollama?" the assistant should search official docs before guessing. Answers may cite documentation paths.

For "What did we decide about the API?" use **Brain**, not the wiki.

## GitHub Wiki (public mirror)

The public GitHub Wiki mirrors generated product documentation from the repository. It is not a live view of your Brain.

## Quick comparison

| Question type | Use |
|---------------|-----|
| How does Minnow Scheduler work? | Wiki or chat + minnow_docs |
| What is our release date for v2? | Brain or Issues |
| Keyboard shortcut for terminal? | Wiki manual or [Keyboard shortcuts](keyboard-shortcuts.md) |
| Import meeting notes into memory | Brain ingest |

## Related

- [Brain app](../apps/brain.md)
- [Minnow manual home](../README.md)
