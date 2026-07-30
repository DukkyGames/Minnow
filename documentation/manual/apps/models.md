# Models

Everything about models lives here: what your machine can run, what you have downloaded, what is serving, which endpoints Minnow talks to, which model does which job, and what it all costs.

Open it from the dock. It opens as a floating window with nine sections.

| Section | What it is |
|---------|------------|
| **Recommendations** | Hardware-aware suggestions from a probe of your machine |
| **Installed** | Model artifacts Minnow has downloaded |
| **Library** | Search Hugging Face, download, and serve locally |
| **Voice** | Speech-to-text and text-to-speech models |
| **Providers** | Endpoints and encrypted API keys |
| **Routing** | Which model handles which job |
| **Sampler** | Temperature and sampling defaults |
| **Thinking** | Reasoning mode and budget |
| **Usage & cost** | Token totals and spend |

The last five also appear under **Models** in the Settings sidebar — same panels, two doors. Settings search finds them either way.

## Recommendations

Minnow probes your actual hardware — CPU, RAM, GPU, VRAM — and scores models by how well they will fit. Start here if you do not already know what your machine can handle; the alternative is downloading 40 GB to discover it swaps.

## Library and Installed

**Library** searches Hugging Face and downloads weights into your Minnow home. **Serve** starts the bundled `llama-server` against a downloaded model and registers it as a provider automatically, so it shows up in the model picker with nothing else to configure.

**Installed** lists what is on disk so you can reclaim space later. Model files are large; they are deliberately kept out of the small-backup path described in [Where your data lives](../reference/configuration.md).

## Providers

A provider is an OpenAI-compatible endpoint. You can have as many as you like, enabled independently.

- **Local runtimes** — LM Studio on `http://localhost:1234` and Ollama on `http://localhost:11434/v1` are detected automatically when they are already running on their default ports.
- **Cloud APIs** — one-click presets for OpenCode Go/Zen, Anthropic, DeepSeek, GitHub Copilot, OpenRouter, OpenAI, Groq and Mistral, plus a custom option.
- **Managed** — anything you serve from the Library.

API keys are encrypted at rest with AES-256-GCM. Losing the key file in your Minnow home means re-entering them.

Refresh a provider after starting or stopping the underlying server; Minnow lists only what the provider reports.

Full walkthrough: [Connect a model](../get-started/connect-a-model.md).

## Routing

The section that most changes how Minnow feels.

Instead of one model doing everything, bind models to **roles**: main chat, chat title generation, the `/goal` evaluator, the UI Designer runtime, and each work agent and sub-agent type — builder, planner, reviewer, researcher and the rest.

Two bindings are worth setting deliberately:

- **Chat title jobs.** A tiny fast model is perfectly good at naming a conversation. Do not spend a frontier model on it.
- **Goal evaluator.** This one judges whether your `/goal` condition is genuinely met. A weak evaluator rubber-stamps broken work, which is worse than no goal at all.

A common arrangement is a fast local model for routine turns and a capable cloud model bound to review, research and evaluation.

## Sampler

Temperature, top-p, top-k, min-p, repeat penalty, presence penalty, max tokens.

The defaults are tuned for the failure mode local models actually have: repetition loops. Presence penalty does that job here; repeat penalty and min-p are deliberately left off because they degrade output on the models Minnow targets. Change these only when you are chasing a specific problem, and change one at a time.

## Thinking

Reasoning mode and token budget for models that expose reasoning. Minnow displays reasoning separately from the answer and times it — the "Thinking…" clock covers reasoning only, stopping when tool calls begin, so the number means something.

## Usage & cost

Token totals for the active chat and for the workspace session. Enter per-million pricing for your models and it becomes actual spend rather than an abstract count.

## Voice

Download local **Whisper** for speech-to-text and **Qwen3-TTS** for text-to-speech, or point voice at a provider instead. Local voice provisions a Python worker on first use.

See [Voice](../extend/voice.md).

## Choosing the model for a turn

| Control | Scope |
|---------|-------|
| **Menubar model chip** | Global default — what new chats start with |
| **Composer picker, Ctrl+M / Cmd+M** | This chat only |

Local runtimes expose **Load** and **Unload** in the composer picker, acting on the model that chat is bound to. The tray menu can unload local models without opening the window — useful when you want your VRAM back.

## When the picker is empty

1. Is the provider process running, with a model loaded?
2. Is the base URL right, including `/v1` where required?
3. Press refresh in **Providers**.

`[providers] fetch failed` at startup is normal when a local runtime is not up yet.

## Related

- [Connect a model](../get-started/connect-a-model.md)
- [Voice](../extend/voice.md)
- [Settings app](settings.md)
- [Troubleshooting](../reference/troubleshooting.md)
