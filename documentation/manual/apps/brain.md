# Brain app

**Brain** is your personal knowledge wiki. The assistant can search and update it while you browse, edit, and curate pages. It is not the read-only **Minnow wiki** opened from **?**.

## Open Brain

Click **Brain** in the dock. The app opens as a **window** you can resize and stack with Models or Settings.

## What lives in Brain

| Area | Purpose |
|------|---------|
| **Graph** | Home view of linked pages and structure |
| **Edit** | Write and update markdown pages |
| **Log** | Append-only style notes and timelines |
| **Schema** | Structure and fields for consistent pages |
| **Proposals** | Review suggested memory or page changes |
| **Memories** | Memory store toggles and entry CRUD |
| **Ingest** | Pull in external sources into Brain |
| **Lint** | Check pages for consistency |
| **Code** | Code-symbol index: repo map, find symbol, callers |
| **Settings** | Embeddings, synthesis cadence, code index options |

Memory-related configuration that used to live under generic Settings now targets **Brain → Memories** and Brain settings.

## How agents use Brain

In chat, enabled tools can search, read, list, write pages, append logs, and ingest sources. Code-oriented tools can explain symbols when the code index is built. **`save_memory`** writes facts into Brain when memory features are on.

## Your data location

Brain content is stored under your Minnow home in the **brain** folder (markdown pages, catalog cache, vectors, sources, and code index data). Back up Minnow home if Brain is critical to your workflow.

## Official docs vs Brain

| | Minnow wiki (**?**) | Brain |
|---|---------------------|-------|
| Content | Product help for your installed version | Your project facts and notes |
| Editable | No at runtime | Yes |
| Use for | "How does Minnow work?" | "What did we decide about auth?" |

More detail: [Wiki and Brain](../reference/wiki-and-brain.md).

## Related

- [Where your data lives](../reference/configuration.md)
- [Modes, skills, and context](../chat/modes-and-skills.md)
