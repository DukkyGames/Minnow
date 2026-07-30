# Troubleshooting

Common problems and fixes for the packaged desktop app. Settings paths refer to the in-app **Settings** app unless noted.

## Startup and connection

| Problem | What to try |
|---------|-------------|
| `[providers] fetch failed` on startup | Normal if LM Studio or Ollama is not running. Start your provider server and refresh under **Models → Providers**. |
| App opens but chat tools fail | Use the installed Minnow app (not a bare browser tab to localhost unless you know the dev setup). Restart from the Start menu after updates. |
| Model picker empty | Provider server running? Correct base URL in **Models → Providers**? Click refresh. Model loaded in LM Studio or Ollama? |
| Empty or garbled assistant text | Provider must speak OpenAI-style chat completions (`/v1/chat/completions`). Some alternate SSE formats yield empty text; try another model or provider profile. |

## Updates (packaged install)

| Problem | What to try |
|---------|-------------|
| No update pill | You may be up to date. Open **Settings → General → App updates** and click **Check for updates**. |
| Download stuck | Wait for the next automatic cycle or retry manual check. Completed downloads stay ready if a later check fails. |
| SmartScreen on first install | Expected for unsigned Windows builds: **More info → Run anyway** once. |

## Diagnostics (local only)

Minnow does **not** send telemetry. Errors stay on your machine.

| Resource | Location |
|----------|----------|
| In-app viewer | **Settings → Advanced → Health & diagnostics** |
| Log files | Minnow home `logs/diagnostics.jsonl` and `logs/crash.jsonl` |
| Copy report | Button in Health & diagnostics (redacted paths and secrets) |

| Problem | What to try |
|---------|-------------|
| Empty health strip | Fully quit and reopen Minnow. |
| Agent cannot read diagnostics | Enable **read_diagnostics** under **Settings → Tools & integrations → Tools**; use **Debug** mode; approve when asked. |

## Models and chat

| Problem | What to try |
|---------|-------------|
| Context ring shows no limit | Model did not report context length metadata. |
| Tools never run | Use a tool-calling-capable model; enable tools in **Settings → Tools & integrations → Tools**; permission not **off**. |
| Images ignored | Use a vision (VLM) model for image attachments. |

## Tools and files

| Problem | What to try |
|---------|-------------|
| Cannot read files outside project | By design: file and git tools stay under the Code workspace root (`filesystemAccess: workspace`). |
| PDF or Office attachment fails | The parsers (`pdf-parse`, `mammoth`, `officeparser`, `xlsx`) are npm **optional dependencies**. Packaged builds include them. In a dev clone, re-run `npm install` without `--no-optional`. |
| Web search does nothing | Check **Settings → Tools & integrations → Search**. The default provider is **SearXNG**, which needs a local instance running (Minnow can manage one). Otherwise switch to DuckDuckGo (no key) or Brave / Tavily (API key required). |
| CORS errors on fetch tools | Full app routes fetch through the local tool server. |

## Browser automation

| Problem | What to try |
|---------|-------------|
| `browser_*` tools missing | Requires the **Electron** Minnow shell, not an external browser without automation. |
| Navigate blocked | Add the site pattern under **Settings → Tools & integrations → Browser**, or approve when prompted. Only `localhost` and `127.0.0.1` are allowed by default. |

## Apps

| Problem | What to try |
|---------|-------------|
| Compare, Benchmarking, Experts, Calendar, Email missing | Expected in this release. They are not in the shipped dock. |
| Scheduler job did not run | Minnow must stay open. Check interval (60s minimum), run history, workspace, and model on the job. |
| Local voice fails | Install Python 3 for local STT/TTS workers, or switch to provider voice in **Models → Voice**. |

## Secrets and data

| Problem | What to try |
|---------|-------------|
| All API keys gone | `.key` was deleted or rotated. Re-enter secrets in Settings. Restore from backup if you saved `.key`. |
| Fresh start | Set `MINNOW_HOME` to a new folder (advanced) or uninstall and remove `.minnow` if you intend to wipe data. |

## Developers cloning the repo

If you run from git instead of the installer:

| Problem | What to try |
|---------|-------------|
| Port in use | Set `PORT` env var and open the printed URL. |
| `npm run dev` only | File, git, terminal, and persistence need `npm start`. |
| Vite stale chunk error | Delete `node_modules/.vite`, restart `npm start`, reload the window. |

## Still stuck?

Use **Copy report** from Health & diagnostics when filing a [GitHub issue](https://github.com/DukkyGames/Minnow/issues). Browse the in-app wiki **?** for deeper technical reference aimed at maintainers.
