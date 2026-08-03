# Install and first launch

Minnow ships as a normal desktop application. This page covers getting it onto your machine, what happens the first time it opens, and how updates work afterwards.

Once it is running, go straight to [Connect a model](connect-a-model.md) — the interface works without one, but nothing can answer you until a provider responds.

## Download

Get the installer from [Minnow Releases](https://github.com/HenriGrimm/Minnow/releases).

| Platform | What you download |
|----------|-------------------|
| Windows | NSIS installer (`.exe`) |
| macOS | `.dmg`, or `.zip` if you prefer to unzip into Applications yourself |
| Linux | No packaged build. Run from source — see the [GitHub Wiki](https://github.com/HenriGrimm/Minnow/wiki). |

### If Windows blocks the installer

Builds may be unsigned, and Windows SmartScreen will say so. Choose **More info**, then **Run anyway**. You should only need to do that once — later in-app updates install without repeating it.

## What happens on first launch

Minnow opens on the **desktop**: a wallpaper, a dock along the top, a menubar, and a chat composer in the middle. That desktop *is* the chat surface — you are not looking at a launcher that will get out of the way.

Two things happen behind the scenes:

- Minnow creates its home folder, `%USERPROFILE%\.minnow` on Windows or `~/.minnow` elsewhere, and scaffolds the folders it uses. Empty directories in there are normal. See [Where your data lives](../reference/configuration.md).
- A local tool server starts on port **9473**. It is what lets chat read files, run git, open a terminal, and save your sessions. It listens on loopback only unless you deliberately turn on LAN access.

You will usually also get the **first-run setup wizard**: a short guided flow for picking a theme, choosing a provider, selecting a model, setting tool permissions, and turning memory on. You can skip it and run it again later from **Settings → General → Run setup again**.

## Closing, quitting, and the tray

Closing the window does **not** quit Minnow. By default it hides to the system tray so chats, agents, scheduled jobs and the tool server keep running. That is deliberate: a long agent run should survive you closing the window.

The tray menu has Open, New chat, current agent/model status, unload local models, Settings, and launch-at-startup. **Quit Minnow** from the tray does a full shutdown.

Change this under **Settings → General → Desktop app**:

- **Keep Minnow running after closing the window** — on by default; turn it off if you want the close button to quit.
- **Launch Minnow at startup** — off by default; this registers a real OS login item.

## Updates

Packaged builds check GitHub Releases in the background. When a build is downloaded and ready, a **Restart** pill appears in the menubar with the new version.

**Settings → General → App updates** has the rest: current version, release notes, a manual **Check for updates**, and the channel.

| Channel | What you get |
|---------|--------------|
| **Stable** | Normal releases. The default. |
| **Beta** | Pre-releases as well. Newer features, rougher edges. |

Two things worth knowing: a completed download stays ready even if a later check fails, so a flaky network does not lose your update; and because closing to tray keeps Minnow alive, an update that wants a restart applies when you actually quit and reopen, not when you close the window.

## Quick health check

If something is clearly not working, in order:

1. Is your model provider actually running, with a model loaded?
2. **Models → Providers** — is the base URL right? Press refresh.
3. **Settings → Advanced → Health & diagnostics** — subsystem probes, grouped errors, and a local log tail. **Copy report** produces a redacted markdown summary you can paste into a bug report.

Everything on that page stays on your machine. Minnow sends no telemetry.

More symptoms and fixes: [Troubleshooting](../reference/troubleshooting.md).

## Next

[Connect a model](connect-a-model.md)
