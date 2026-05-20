# Expert prompt template

Experts are domain personas injected into the system prompt **after** the operating mode and **before** work-agent / tool-usage parts.

## Layout

| Root | Path |
|------|------|
| Built-in | `src/chat/prompts/experts/<id>/` |
| User override | `~/.minnow/prompts/experts/<id>/` (same `id` wins over built-in) |

Each expert folder needs:

- `expert.full.md` — full profile body + YAML front matter
- `expert.lite.md` — shorter body for Lite profile

## Auto vs manual

- **Auto** — rules router scores keywords/regex on each send; optional LLM classifier when `experts.classifier` is `llm` or `rules+llm` in `config.json`.
- **Manual** — composer dropdown picks an expert; that id is used on every send until you switch back to Auto.

## Front matter (routing)

Use flat lists in YAML (see `EXPERT_TEMPLATE.md`):

- `keywords` — substring matches (+2 each)
- `negativeKeywords` — penalty (-10)
- `regex` — optional patterns (+5 each, max 3)
- `priority` — tie-break integer
- `default: true` — fallback when Auto has no winner
- `classifierHint` — one line for optional LLM classifier

Copy `example.full.md` / `example.lite.md`, rename folder to your `id`, and restart or refresh the app.
