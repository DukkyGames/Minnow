# Setup guide

A step-by-step walkthrough to get Minnow running locally. For the short version, see the [README quick start](../../README.md#quick-start). Everything else: [documentation index](../README.md).

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 18+** (20+ recommended) | ES modules, Vite 6, native `node:test`. Check with `node -v`. |
| **npm** | Ships with Node. |
| **Git** | To clone the repo. |
| **LM Studio** or another OpenAI-compatible provider | Needed to actually chat. The UI launches without one. |
| **Python 3** *(optional)* | Only for **local** voice (STT/TTS). Provisioned on demand. |

Native modules (`better-sqlite3`, `@lydell/node-pty`) ship prebuilt binaries for common platforms. A C/C++ toolchain is only required if npm falls back to building from source.

## 2. Clone & install

```bash
git clone https://github.com/DukkyGames/Minnow.git
cd Minnow
npm install
```

`postinstall` automatically:

- vendors the **Impeccable** UI-design skill into `src/skills/impeccable/` (`scripts/sync-impeccable-skill.mjs`), and
- ensures the **Electron** binary is present (`scripts/ensure-electron.mjs`).

Both are idempotent — safe to re-run.

### Optional document parsers

PDF/Word/Excel attachment support comes from `optionalDependencies`, which install best-effort. If an attachment type fails, install it explicitly:

```bash
npm install pdf-parse mammoth officeparser
# xlsx is fetched from the SheetJS CDN per package.json
```

## 3. Start a model provider

You need at least one OpenAI-compatible endpoint. Easiest is **LM Studio**:

1. Install and open **[LM Studio](https://lmstudio.ai/)**.
2. Download and **load** a chat model.
3. Open the **Developer / Server** tab and **Start Server** (default `http://localhost:1234`).
4. Confirm the model is listed in LM Studio's server UI.

Alternatives — all configured in **Settings → Models → Providers**:

- **Ollama** — point Minnow at `http://localhost:11434/v1`.
- **llama.cpp `llama-server`** — or let the **Models** app download and serve a model for you.
- **Cloud APIs** — any OpenAI-compatible base URL + API key (stored encrypted).

### LM Studio headless (optional, for servers/CI)

```bash
curl -fsSL https://lmstudio.ai/install.sh | bash
export PATH="$HOME/.lmstudio/bin:$PATH"
lms daemon up && lms server start
lms get <model-name> -y
lms load <model-name> -y
```

## 4. Run Minnow

```bash
npm start
```

This starts Vite + the Node tool server on **port 9473** (or the next free port — watch the terminal) and launches the **Electron desktop shell**. It also prints `Minnow data: <path>` showing your `~/.minnow` home.

**Variants:**

```bash
MINNOW_BROWSER=1 npm start     # open a system browser tab instead of Electron
BROWSER=none npm start         # don't auto-open anything (CI/headless)
PORT=3000 npm start            # custom port (PowerShell: $env:PORT=3000; npm start)
```

> `PORT=5173` is deliberately ignored and coerced back to 9473 — 5173 is reserved for dev servers running in your *workspace*, so agents can start a Vite app without colliding with Minnow itself.

> Use `npm start` (not `npm run dev`) whenever you want file/git tools, persistence, terminal, attachments, the browser preview, or any of the apps. `npm run dev` is Vite-only.

Verify the server is healthy. Every `/api/*` route requires the per-boot session token written to `~/.minnow/session-token`, so pass it:

```bash
curl -H "X-Minnow-Token: $(cat ~/.minnow/session-token)" http://localhost:9473/api/tools/ping
# {"ok":true}
```

```powershell
# PowerShell
curl.exe -H "X-Minnow-Token: $(Get-Content $env:USERPROFILE\.minnow\session-token)" http://localhost:9473/api/tools/ping
```

A bare request without the header returns `401 Unauthorized` — that is the gate working, not a broken server.

## 5. First-run checklist in the UI

1. **Provider** — Settings → Models → Providers: confirm the base URL and that the provider is reachable.
2. **Model** — pick one from the menubar model chip (use refresh if empty). Vision tasks need a **VLM** model; many tools work better with a tool-calling-capable model.
3. **Mode** — choose in the composer: General / Build / Plan / Debug. (Orchestrate opens from the sidebar hub, not the composer picker.)
4. **Tools** — Settings → Tools: enable the capabilities you want, set per-tool permission (`full` / `ask` / `off`). Server tools need `npm start` and a healthy tools ping.
5. **Workspace** — open the **Code** app and pick a project folder; file/git tools resolve under this root.

## 6. Optional setup

- **Models app** — hardware-aware recommendations, Hugging Face downloads, and local serving (`Models → Recommend / Installed`).
- **Voice** — Models → Voice: download local Whisper (STT) / Qwen3-TTS, or use a provider. Local voice provisions a Python worker on demand.
- **Memory & Brain** — Settings → Memory: enable the store and optional semantic embeddings (local or provider).
- **MCP** — Settings → MCP: Context7 is built in; add custom servers.
- **Skills Library** — Settings → Integrations → Skills Library: browse and install curated third-party `SKILL.md` packs. Only 15 skills ship in the box; everything else is opt-in, and you can write your own into `~/.minnow/skills/`.
- **Webhooks** — Settings → Webhooks: HMAC-signed outbound deliveries (SSRF-guarded).

> The **Email** and **Calendar** apps are release-gated off in this build, so there is no IMAP/CalDAV setup step — see [apps.md](apps.md#behind-the-release-gate).

## 7. Next steps

- Tour the apps: [apps.md](apps.md)
- Full command reference: [commands.md](commands.md)
- Architecture: [architecture.md](architecture.md)
- Where data lives: [configuration.md](configuration.md)
- Extend it: [tool authoring](../plugins/tool-authoring.md), [agent packs](../agent-packs/README.md)
