# Step 20 verification — Settings page

## Automated

```bash
npm test
npm run build
```

## Manual

1. Open app with `npm start`.
2. Click Settings (gear) → full-page settings at `#/settings/general`.
3. Prompting: switch Full / Lite / Custom — status shows profile change.
4. Memory: toggle enable; backup/clear buttons respond when server up.
5. Features: toggle self-healing (persists to `config.json` when `npm start`).
6. Back to chat returns to main UI.

## Deferred

Import/export zip, per-part Monaco editors, topbar per-tool/MCP popovers (follow-up).
