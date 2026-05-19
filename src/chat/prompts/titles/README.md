# Chat title prompts (Step 07)

Short LLM prompts used to generate sidebar chat titles on the **first user message** when the chat is still named `New chat`.

## Variables

| Token | Meaning |
|-------|---------|
| `{{userMessage}}` | First message seed (plain text, attachment name, or `[image: …]` markers) |

The seed is also sent as the API `user` message; `{{userMessage}}` is only for few-shot examples inside the system template.

## Shipped file

- `default.md` — bundled with the app (`kind: title`, `id: default`)

## User override

Place a file at:

```text
~/.speedchat/prompts/titles/default.md
```

When `npm start` is running, overrides are picked up via `GET /api/prompts/registry` (same as other prompt kinds). In Vite-only mode (`npm run dev`), only the shipped bundled prompt is used.

## Config (`config.json`)

| Key | Default |
|-----|---------|
| `titles.enabled` | `true` |
| `titles.modelId` | `""` (use chat model) |
| `titles.providerId` | `""` (use chat / active provider) |
| `titles.maxTokens` | `24` |
| `titles.temperature` | `0.3` |

## Behavior

- Async, non-streaming, non-blocking (does not delay the main completion).
- At most one in-flight job per `chatId`.
- Discarded if the user renames or deletes the chat before the job finishes.
