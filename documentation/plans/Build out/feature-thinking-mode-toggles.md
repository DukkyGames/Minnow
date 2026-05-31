# Thinking mode toggles

## Decisions (closed)

| Question | Choice |
|----------|--------|
| Parent chat vs sub-agents | Explicit chat `on` / `off` applies to **main completions and all sub-agent runs** for that chat |
| Composer control | Full tri-state: `inherit` / `on` / `off` |
| Global default | **`on`** for new chats and inherited paths |

## Resolution stack

1. **Global** — `config.json` → `thinking.defaultMode` (`on` | `off`), default `on`.
2. **Work agent** — shipped `work-agent-thinking.json` + `work-agents.json` override `thinkingMode`.
3. **Sub-agent type** — shipped `sub-agents.json` `thinkingMode` + user merge.
4. **Chat** — `Chat.thinkingMode` tri-state; default / missing = `inherit`.
5. **Parent override** — When chat is `on` or `off`, that value wins for main loop **and** sub-agents (`resolveThinkingMode` in `src/agents/resolve-thinking.ts`).

## Provider wire format

`thinkingToCompletionBody` (`src/agents/thinking-to-body.ts`) sends:

- `reasoning_effort`: `none` | `medium`
- `reasoning`: `{ effort: … }`
- `enable_thinking`: boolean

LM Studio may ignore these in favor of Inference UI custom fields ([issue #988](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/988)); the app shows a one-shot session hint when using `lm-studio-v0`.

Catalog ingest: model list `reasoning.allowed_options` → `ModelCapabilities.reasoningAllowedOptions`.

## UI

- **Composer** — `#composerThinkingControl` tri-state (`src/ui/composer-thinking.ts`).
- **Settings → Thinking** — global on/off + work-agent and sub-agent rows (`src/ui/settings-thinking.ts`).

## Shipped defaults

**Work agents:** `builder`/`default` → inherit; `planner`/`reviewer`/`researcher` → on; `ui-designer` → off.

**Sub-agents:** `explore`/`shell` → off; `generalPurpose` → inherit.

## Out of v1

Title generation, editor AI autocomplete, and benchmark runs do not expose thinking toggles (global/off behavior documented in `documentation/context.md`).
