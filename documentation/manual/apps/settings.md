# Settings app

**Settings** is the full configuration surface: appearance, tools, modes, skills, providers, integrations, and diagnostics. Open it from the dock or the menubar gear.

## Find a setting quickly

1. Open **Settings**.
2. Press **Ctrl+K** / **Cmd+K** to focus **search**.
3. Type a keyword (for example "webhook", "MCP", "voice").
4. Arrow keys and **Enter** open the matching section. **Escape** closes overlays or blurs search.

Some results deep-link out of Settings: memory queries open **Brain**, and provider or sampler queries open the **Models** app.

## Section map

The sidebar has five groups:

| Group | Sections |
|-------|----------|
| **App** | General (includes **App updates**), Notifications, Appearance, Audio, About |
| **Apps** | Apps, Issues |
| **Agents** | Agents, Rules, Agent packs, Autopilot, Watchdog |
| **Tools & integrations** | Search, Deep Research, Servers, Tools, Skills, Skills Library, Browser, MCP servers, Language servers, Editor, Webhooks |
| **Advanced** | Health & diagnostics, Board testing |

**Providers, Routing, Sampler, Thinking, and Usage & cost are not in this sidebar.** They live in the **Models** app. Settings search still finds them and deep-links across.

## Tools and permissions

**Settings → Tools & integrations → Tools** lists built-in and plugin tools by category.

| Permission | Behavior |
|------------|----------|
| **full** | Run without prompting |
| **ask** | Show approval strip (digits 1/2/3 in chat) |
| **off** | Model cannot use the tool |

Server-side tools need the packaged app or `npm start` dev stack; a few browser-only tools never run on the server API.

## Skills

Both live under **Tools & integrations → Skills**:

- **Skills**: enable the 15 bundled skills and your own `SKILL.md` folders.
- **Skills Library**: install curated third-party packs.

## Providers

Provider URLs and encrypted API keys live in the **Models** app under **Providers** — not in Settings. Searching "provider" in Settings takes you there.

## Health and diagnostics

**Advanced → Health & diagnostics** shows local health, recent errors, log tail, and **Copy report** (redacted markdown for bug reports). Nothing is sent off-device automatically.

## Network access

Default is **loopback only**. Opt in under **General** if you want LAN companion access. Restart after changing network mode.

## Related

- [Install and first launch](../get-started/install.md)
- [Where your data lives](../reference/configuration.md)
- [Troubleshooting](../reference/troubleshooting.md)
