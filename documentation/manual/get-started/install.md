# Install and first launch

This page covers installing Minnow from a packaged release, opening it the first time, and connecting a local model through the Settings UI.

## Download the installer

1. Go to [Minnow Releases](https://github.com/DukkyGames/Minnow/releases) on GitHub.
2. Download the installer for your platform: **Windows** ships an NSIS `.exe`, **macOS** ships `.dmg` and `.zip`. There is no Linux package.
3. Run the installer and follow the prompts. Minnow installs like any desktop app.

### Windows SmartScreen

Packaged builds may be **unsigned** on first install. Windows might show a SmartScreen warning. Choose **More info**, then **Run anyway**. After the first install, in-app updates typically do not repeat that step.

## First launch

1. Open **Minnow** from the Start menu or desktop shortcut.
2. The desktop shell opens with **Chat** on the main surface: composer at the bottom, chat rail on the left, dock and menubar at the top.
3. On first run you may see **onboarding**: a guided chat that helps you pick basics. You can complete it or skip when offered.

Minnow stores your profile under your **Minnow home** folder (see [Where your data lives](../reference/configuration.md)). The app prints the path on startup when run from a terminal; on a normal double-click install, expect `%USERPROFILE%\.minnow` on Windows.

### Updates

Packaged Minnow checks for updates in the background. When a build is ready, a menubar pill may show **Restart** with the new version. You can also open **Settings → General → App updates** for status, release notes, Stable vs Beta channel, and **Check for updates**.

Closing the window may hide Minnow to the **system tray** instead of quitting (default). Use the tray menu to exit fully when you want updates to apply on quit.

## Connect a model provider

You need at least one **OpenAI-compatible** chat endpoint. The UI works without one, but the model picker stays empty until a provider responds.

### Option A: LM Studio (common on Windows)

1. Install and open [LM Studio](https://lmstudio.ai/).
2. Download a chat model and **load** it in LM Studio.
3. Open the **Developer** or **Local Server** tab and **Start Server** (default `http://localhost:1234`).
4. In Minnow, open the **Models** app from the dock.
5. Go to **Providers**.
6. Confirm or add a provider pointing at `http://localhost:1234` (or your LM Studio URL), then refresh it.
7. Use the **model chip** in the menubar or **Ctrl+M** / **Cmd+M** in the composer to pick a model.

A log line like `[providers] fetch failed` on startup is normal if LM Studio is not running yet. Start the server and refresh providers.

### Option B: Ollama

1. Install [Ollama](https://ollama.com/) and pull a model (`ollama pull …`).
2. Ollama serves an OpenAI-compatible API at `http://localhost:11434/v1`.
3. In Minnow: **Models → Providers**, add or edit a provider with that base URL.
4. Refresh and select a model from the picker.

### Option C: Download and serve inside Minnow

Open the **Models** app from the dock. Use **Recommendations** for hardware-aware suggestions, **Library** to fetch weights from Hugging Face, and serve them locally with the bundled `llama-server`. Minnow registers that runtime as a provider for you. Details: [Models app](../apps/models.md).

### Cloud APIs

Any OpenAI-compatible HTTPS endpoint works. Add the base URL and API key under **Models → Providers**. Keys are encrypted on disk.

## Quick health check

If chat or tools fail:

1. Confirm your provider server is running and a model is loaded.
2. Open **Settings → Advanced → Health & diagnostics** for a local status strip and error log.
3. See [Troubleshooting](../reference/troubleshooting.md) for common fixes.

## Next step

[Your first chat](first-chat.md)
