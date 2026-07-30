# Where your data lives

Minnow is **local-first**. Chats, settings, Brain, downloaded models, and encrypted secrets stay on your computer under **Minnow home**. Nothing leaves the machine except traffic you send to model or search providers you configure.

## Minnow home

| Platform | Default path |
|----------|----------------|
| Windows | `%USERPROFILE%\.minnow` |
| macOS / Linux | `~/.minnow` |

When Minnow starts from a terminal, it prints `Minnow data: <path>`. Advanced users can point to another folder with the `MINNOW_HOME` environment variable for isolated profiles.

## Back up these items

| Item | Why |
|------|-----|
| **`.key`** file | Encrypts API keys, OAuth tokens, email passwords, webhook secrets. **If you lose `.key`, encrypted secrets cannot be recovered.** Re-enter keys in Settings. |
| **`sessions/`** | Chat history database |
| **`brain/`** | Your wiki and memory pages |
| **`config.json`** | Preferences (providers, features, voice, etc.) |
| **`models/`** | Large downloads (optional backup if you prefer not to re-download) |

Copy the whole Minnow home folder to backup storage, or use your normal backup tool with `.minnow` included.

## What each area stores

| Folder or file | Contents |
|----------------|----------|
| `config.json` | Active provider, workspace, feature flags, voice, synthesis, oauth blocks |
| `.key` | Encryption key for secrets (restrict permissions on Unix) |
| `sessions/` | SQLite chat sessions and search index |
| `chats/` | Assistant workspace chat data |
| `tools.json` | Per-tool permissions (`full` / `ask` / `off`) |
| `search.json` | Search provider (default SearXNG), fallback chain, Brave / Tavily keys |
| `providers/` | Provider profiles and encrypted secrets |
| `skills/` + `skills.json` | User skills and enable flags |
| `rules.json` | Global user rules |
| `issues/` | Issue state and taxonomy (`state.json`, `taxonomy.json`) |
| `profiles/` | Portable prompt and tool bundles |
| `brain/` | Brain wiki pages, vectors, ingest sources, code index |
| `models/` | Downloaded model artifacts; voice snapshots under `models/voice/` |
| `voice/` | Python venv and worker metadata for local speech |
| `scheduler.json` + `scheduler-runs/` | Scheduler jobs and run history |
| `webhooks.json` | Outbound webhook config |
| `oauth/` | Encrypted OAuth tokens |
| `updater.json` | Stable vs Beta update channel choice |
| `logs/` | Local diagnostics logs (`diagnostics.jsonl`, `crash.jsonl`) |

Minnow scaffolds every folder in this list on first run, so an empty `calendar/` or `benchmarks/` directory is normal even though those apps are not in the shipped dock.

## Encrypted secrets

Provider API keys and similar values are stored encrypted. Deleting or rotating `.key` wipes the ability to decrypt them. Plan key backup before OS reinstall.

## Clean profile

To experiment with a fresh Minnow home, set `MINNOW_HOME` to an empty directory before launch (advanced). Your normal profile remains untouched.

## Settings vs files on disk

Most values in `config.json` are edited through **Settings**. Direct file editing is for recovery or advanced use; Minnow normalizes config on load.

For the exhaustive key-by-key inventory, see [Settings reference](https://github.com/DukkyGames/Minnow/wiki) on the GitHub Wiki (maintainer material, not needed for daily use).

## Related

- [Troubleshooting](troubleshooting.md)
- [Brain app](../apps/brain.md)
- [Wiki and Brain](wiki-and-brain.md)
