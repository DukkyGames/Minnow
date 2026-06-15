# Unify tool permissions

**Status:** Shipped (2026-06-15)

## Problem

Tool permission checks used three overlapping layers: auto-approve `patterns`, `perAgent` overrides, and a **General mode gate** that forced `ask` on every tool even when Settings showed **Full permission**. Chat app sessions run in General mode, so users saw approval strips despite Full settings. The Chat app composer also lacked the quick tools popover present on the Code composer.

## Solution

Single source of truth: **`permissions.default[toolId]`** (`off` | `ask` | `full`).

- Removed `applyGeneralModeApprovalGate` — General / Chat app respect the catalog like Build/Plan/etc.
- Removed auto-approve `patterns` and `perAgent` overrides (Settings UI, resolution logic, persistence on write).
- **Always allow** writes `permissions.default[toolId] = 'full'` globally.
- Added Chat app tools popover (`#btnChatAppTools`, `#chatAppToolsList`) synced with Settings and Code composer.

**Kept:** workspace path guard — `full` still prompts when paths leave the workspace under workspace-only filesystem access.

## Key files

| Area | Files |
|------|-------|
| Resolution | `src/tools/permission-resolve.ts`, `src/tools/permission-gate.ts` |
| Config | `src/tools/config.ts`, `src/tools/tool-settings-types.ts`, `server/config/validators.js` |
| UI | `src/ui/composer-tools-popover.ts`, `index.html`, `src/styles/chat-app.css` |
| Prompts | `src/chat/prompts/modes/general.*.md`, `work-agents/general/agent.lite.md` |
| Tests | `test/tools/permission-resolve.test.mts`, `test/tools/tools-list-sync.test.mjs` |

## Expected behavior

| Setting | General / Chat app | Build / other modes |
|---------|-------------------|---------------------|
| Full | No strip (unless path outside workspace) | Same |
| Ask | Approval strip each run | Same |
| Off | Tool hidden + blocked | Same |
