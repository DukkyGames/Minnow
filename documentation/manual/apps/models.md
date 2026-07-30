# Models app

The **Models** app is the control center for what runs on your machine and how Minnow talks to it: recommendations, downloads, local servers, providers, routing, voice, and usage.

## Open Models

Click **Models** in the dock. It opens as a window with nine sidebar sections:

| Section | Use |
|---------|-----|
| **Recommendations** | Fit scores from a hardware probe of your machine |
| **Installed** | Artifacts Minnow downloaded under Minnow home `models/` |
| **Library** | Search and download weights from Hugging Face |
| **Voice** | Local speech-to-text and text-to-speech models |
| **Providers** | Endpoint URLs and encrypted API keys |
| **Routing** | Which model handles which task type |
| **Sampler** | Temperature and sampling presets |
| **Thinking** | Reasoning controls, for models that support them |
| **Usage & cost** | Token and cost totals |

The last five also answer to Settings search, which deep-links here.

## Common tasks

### Add LM Studio or Ollama

Open **Providers**. Minnow detects **LM Studio** (`http://localhost:1234`) and **Ollama** (`http://localhost:11434/v1`) when they are already running on their default ports; otherwise add the base URL yourself and refresh.

### Download and run a model locally

Use **Library** to fetch weights from Hugging Face, then serve them with the bundled `llama-server`. Minnow registers the running server as a provider automatically, so it appears in the model picker without extra setup.

### Voice

Under **Voice**, download local **Whisper** (speech-to-text) or **Qwen3-TTS** (text-to-speech), or point voice at a provider instead. Local voice provisions a Python worker on first use, so it needs Python 3 installed.

## Menubar model chip

The menubar chip and the composer **Ctrl+M** / **Cmd+M** picker both set the **active chat model** for the current chat. The list contents come from whatever your providers report on refresh.

## Troubleshooting empty picker

1. Start the LM Studio server or Ollama.
2. In **Models → Providers**, check the base URL and refresh.
3. Load a model in the external runtime — Minnow lists only what the provider reports.

See [Troubleshooting](../reference/troubleshooting.md).

## Related

- [Install and first launch](../get-started/install.md)
- [Settings app](settings.md)
