# Agent packs

Drop-in work agent bundles for Minnow. Copy a folder to:

```text
~/.minnow/agent-packs/<pack-id>/
  manifest.json
  prompts/
    my-agent.full.md
    my-agent.lite.md
```

## Manifest

See [`src/agents/schema/agent-pack.schema.json`](../../src/agents/schema/agent-pack.schema.json) for the JSON Schema.

- **Pack id** must match the folder name (`^[a-z][a-z0-9-]{0,63}$`).
- **Agent ids** are namespaced as `packId.agentKey` (e.g. `security.auditor`).
- **Prompt paths** are relative to the pack root; path traversal is rejected at scan time.
- **Tool names** must exist in the built-in tool catalog.

## Enable / disable

- Default: enabled (unless `enabled: false` in manifest).
- User override: `~/.minnow/agent-packs.json` → `{ "<pack-id>": { "enabled": false } }`.
- Settings → **Agent packs** toggles call `PATCH /api/agent-packs/:id`.

## APIs (requires `npm start`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-packs` | List packs with validation status |
| GET | `/api/agent-packs/:id` | One pack |
| PATCH | `/api/agent-packs/:id` | `{ "enabled": true \| false }` |

Pack agents are merged into `GET /api/work-agents` with `source: "pack"`.

## Precedence

1. Built-in work agent
2. Pack agent (if enabled and valid)
3. User scalars in `~/.minnow/work-agents.json`
4. User prompt files in `~/.minnow/prompts/work-agents/<id>/`

## Template

On first `npm start`, `~/.minnow/agent-packs/_template/` is created (ignored by the scanner). Copy it to a new id without the leading underscore.
