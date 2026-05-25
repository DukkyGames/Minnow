# Feature 13 — Prompt profiles verification (MIN-49)

## Automated

```bash
npx tsc --noEmit
node --test test/profiles/*.test.mjs
```

## Manual (npm start)

1. Settings → Prompting → **Save current as…** → create `qa-setup`.
2. Change tool permissions (e.g. disable `execute_command`).
3. **Apply** `qa-setup` → confirm dialog → verify tools restored.
4. **Export** → delete local profile → **Import** file → **Apply**.
5. Enable **Auto-apply on workspace switch** and **Workspace default** for current path.
6. Switch workspace → confirm profile applies (toast / active label).

## API smoke

```bash
curl -s http://localhost:5173/api/profiles | jq .
```
