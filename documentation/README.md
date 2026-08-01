# Minnow documentation

Everything written down about Minnow, in one index. New here? Read [Setup](guides/setup.md), then [Apps](guides/apps.md).

## Using Minnow

| Guide | What's in it |
|-------|--------------|
| [Setup](guides/setup.md) | Prerequisites, install, providers, first run, optional extras. |
| [Apps](guides/apps.md) | The eight apps, the composer modes, and what's behind the release gate. |
| [Commands](guides/commands.md) | Every npm script, the headless CLI, test suites, environment variables. |
| [Keyboard shortcuts](guides/keyboard-shortcuts.md) | Composer, editor, file tree, terminal, mail, and global key bindings. |
| [Orchestrate board testing](guides/orchestrate-board-testing.md) | `test:board`, fake model, seed board, log invariants. |
| [Release E2E testing](guides/release-e2e-testing.md) | Manual pre-release checklist — all shipped apps, modes, and settings. |
| [Configuration](guides/configuration.md) | The `~/.minnow` folder, `config.json`, providers, encrypted secrets. |
| [Troubleshooting](guides/troubleshooting.md) | When it won't start, won't connect, or a tool won't run. |

## Building on Minnow

| Doc | What's in it |
|-----|--------------|
| [Architecture](guides/architecture.md) | The three processes, the SPA, the tool server, the agent layer. Start here. |
| [context.md](context.md) | The complete technical reference: every subsystem, API, and store. Dense, kept current. |
| [Tool authoring](plugins/tool-authoring.md) | Write a local tool plugin for `~/.minnow/tools/`, no MCP needed. |
| [Agent packs](agent-packs/README.md) | Bundle prompts and agents for sharing. |
| [Design system](design-system/README.md) | The extracted `--mn-*` token inventory, primitives, and themes. |
| [../DESIGN.md](../DESIGN.md) | Palette families, typography, elevation, component rules. |
| [../PRODUCT.md](../PRODUCT.md) | Who it's for, what it is and isn't, design principles. |
| [../AGENTS.md](../AGENTS.md) | Orientation for AI coding agents working in this repo. |

## Maintaining Minnow

Release and internal-inventory docs live in [`maintainer/`](maintainer/) — [releasing](maintainer/releasing.md), [macOS signing](maintainer/macos-signing.md), the full [settings reference](maintainer/settings-reference.md), the [prompt ownership matrix](maintainer/prompt-ownership-matrix.md), and the [Discord server setup](maintainer/discord-setup.md).

## Working folders

These are inputs to the tools, not prose to read:

- [`plans/`](plans/) — feature plans. Plan mode and the orchestrator write here in *your* workspace too; that path is a convention Minnow depends on.
- [`schemas/`](schemas/), [`templates/`](templates/), [`specs/`](specs/) — JSON schemas and scaffolding used by the app.
- [`memory/`](memory/), [`MEMORY.md`](MEMORY.md) — curated notes for agents working on Minnow itself.
- [`extracts/`](extracts/), [`archive/`](archive/) — portable code extracts and one-time migration snapshots.
- [`images/`](images/) — screenshots used by the README.
