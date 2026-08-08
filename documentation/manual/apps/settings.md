# Settings

Everything configurable, in seven categories. Open it from the app rail or the menubar gear.

## Find things by searching

Press **Ctrl+K** / **Cmd+K** with Settings open. Type a keyword — "webhook", "tray", "MCP", "temperature", "memory" — and the results deep-link straight to the control, highlighting it when you land.

Search crosses app boundaries: a memory query opens **Brain**, a provider or sampler query opens the **Models** app. That is intentional, because those settings genuinely live there.

## The map

### General

| Section | Contains |
|---------|----------|
| **General** | App updates and channel, desktop app and tray, launch at startup, network access, filesystem access, terminal behaviour and default shell, constrained tool calls, re-run setup |
| **Notifications** | Master toggle, per-category (chat, tasks, background jobs), sounds, sounds while watching the active chat |
| **Audio** | Input and output devices, echo cancellation, noise suppression, auto gain |
| **About** | Version and build info |

Two settings here matter more than the rest:

- **Filesystem access** — workspace-only (default) or full disk. This is the containment boundary for every file and git tool. See [Tools and permissions](../concepts/tools-and-permissions.md).
- **Network access** — loopback-only (default) or LAN. Changing it needs a restart. See [Use Minnow from another device](../extend/companion.md).

### Apps

**Apps** lists what is installed. Every shipped app is core, so there is nothing to disable and you will see a "Coming soon" placeholder where optional apps will appear.

**Issues** is the taxonomy editor for the tracker: types, statuses with workflow roles and board flags, and priorities.

### Appearance

Theme family and mode — 16 themes in total, eight families each with a dark and a light variant — plus desktop wallpaper, fonts, and custom accent colours.

### Models

**Providers**, **Routing**, **Sampler**, **Thinking**, **Usage & cost**. These are the same panels the [Models app](models.md) shows.

### Agents

| Section | Contains |
|---------|----------|
| **Agents** | Prompt profiles (Full / Lite / custom) with a live token estimate, composer modes, Super Plan pipeline settings, plan granularity, work agents, sub-agent types, context policy, setup profile export and import |
| **Rules** | Standing instructions injected into every prompt, organised into groups |
| **Agent packs** | Download a template or the built-in pack, upload a zip, manage installed packs |
| **Autopilot** | Defaults for orchestrate boards: execution mode, git worktree isolation (not host containment), concurrency, planner model, retries, self-heal, infra provisioning |
| **Watchdog** | Generation limits while streaming, plus agent stall, heartbeat, and loop detection |

**Watchdog** is the setting to reach for when a run hangs and sits there forever. It has two halves.

**Generation timeouts** cover the model stream itself. The idle timeout resets whenever new tokens arrive, so it catches a genuinely stalled stream without cutting off a slow one.

**Agent supervision** covers agents — both sub-agents and orchestrate task chats:

| Setting | Default | What it does |
|---------|---------|--------------|
| **Stall timeout** | 90 sec | How long an agent may go without producing anything visible — streamed text, reasoning, or a tool call — before it counts as stuck |
| **Unresponsive after** | 30 sec | How long without any heartbeat before the run is treated as dead. Liveness only, not model output |
| **Heartbeat interval** | 7 sec | How often a running agent reports in |
| **Repeated tool limit** | 5 | How many identical tool calls (same name and arguments) may occur close together before the run counts as looping. `0` turns it off |

When a run trips one of these, read-only agents are restarted from scratch, bounded by **Max self-heal rounds** under Autopilot. Agents that can write files are not auto-restarted — the task is marked blocked instead.

The stall timeout is the usual culprit behind a long plan review or research pass getting cut short: a model that reasons for two minutes in one non-streaming completion produces nothing observable for that whole time. Raise it before reaching for anything else. Repeats spread across a long run no longer count as a loop — only bunched-up identical calls do — so the repeated tool limit rarely needs changing.

### Integrations

| Section | Contains |
|---------|----------|
| **Search** | Web search provider, fallback chain, Brave and Tavily keys |
| **Deep Research** | Research model, search override, round and time limits, extraction settings, report size |
| **Servers** | Managed local servers — SearXNG and `llama-cpp` — enable, auto-start, port |
| **Tools** | The full tool catalog with Off/Ask/Full per tool, grouped by category, plus bulk actions and the result cache |
| **Skills** | Enable or disable skills, author your own, and the **Skills Library** for third-party packs |
| **Browser** | Automation allowlist, navigation permission, tab restore, DevTools dock |
| **MCP servers** | Model Context Protocol servers |
| **Language servers** | LSP configuration and diagnostics |
| **Editor** | Ghost text, inline completion, context sources, caching |
| **External** | Outgoing webhooks with HMAC signing |

### Advanced

**Health & diagnostics** — subsystem probes, grouped errors, a local log tail, **Copy report** for a redacted summary, and the toggle for filing renderer errors as issues. Nothing is sent off-device.

**Board testing** — a manual workflow for orchestrate boards: an in-process fake model, seeded test boards, and board-log validation. For development and debugging, not daily use.

## Where settings are stored

In your Minnow home as separate files — `config.json`, `tools.json`, `search.json`, `rules.json`, `skills.json`, and others. Secrets are encrypted; the rest is plain JSON you could read in an editor, though Settings normalizes on load and hand-editing is a recovery tool, not a workflow.

See [Where your data lives](../reference/configuration.md).

## Related

- [Tools and permissions](../concepts/tools-and-permissions.md)
- [Context, memory, and rules](../concepts/context-and-memory.md)
- [Integrations](../extend/integrations.md)
- [Agents, sub-agents, and packs](../orchestrate/agents.md)
