# Step 20 verification — Settings page

**Status:** PASS (re-verify 2026-05-19)

## Automated

```bash
npm test
npm run build
node src/skills/impeccable/scripts/speedchat-context.mjs
```

| Check | Result |
|-------|--------|
| `npm test` | PASS (node + tsx) |
| `npm run build` | PASS |
| `test/ui/settings-sections.test.mjs` | Module export smoke |

## Wired (no placeholder stubs)

| Section | Data source |
|---------|-------------|
| General | `listProviders`, `detectConfigServer` |
| Prompting | `savePromptMetaSettings`, `GET/PUT /api/prompt-configs`, part previews |
| Providers | `GET /api/providers`, set-active |
| Modes | `listModes()` |
| Experts | `listExperts()` |
| Work agents | `listWorkAgents()` |
| Sub-agents | `loadSubAgentConfig`, `PUT /api/config/sub-agents` |
| Memory | `fetchMemoryStatus`, memory API toggles |
| Features | `config.json` features + self-healing |
| Tools | `fillToolsSection('settingsToolsList')`, `tools.json` |
| MCP | `GET /api/mcp/servers`, `PUT .../enabled` |
| LSP | `GET/PUT /api/config/lsp` |
| Skills | `GET /api/skills`, catalog paths |

## Manual

1. `npm start` → open `#/settings/general` — active provider and storage mode shown.
2. Prompting → Custom → New/Save/Duplicate/Delete named configs; Full/Lite show part previews.
3. MCP/LSP sections list servers with toggles when server is up.
4. Tools section mirrors drawer toggles; Brave key saves.
5. Back to chat restores main shell.

## Deferred

Import/export zip, Monaco part editors, topbar Expert/Tools/MCP popovers (follow-up).
