# Smart Concierge Agent

**Status:** Shipped (2026-06-12)

## Summary

Replaces keyword-only MinnowOS concierge routing with a fast structured LLM planner that picks the right app, refines the user's intent into an app-specific seed, and auto-starts work where supported (Research runs, Code debug/build chats with workspace selection).

## Problem

The desktop concierge called `routeIntent()` (regex keywords) and passed **raw** user text as `seed`. That worked for navigation but not for intent refinement or auto-execution.

| User says | Before | After |
|-----------|--------|-------|
| "Let's research apple stock" | Opens Research, full sentence seed, no auto-run | Opens Research, seed **"Apple stock (AAPL)"**, **starts run** |
| "Look for bugs in my finance app" | Opens Code (keyword `debug`), no workspace/mode/send | Picks **finance** workspace, **Debug mode**, new chat, **auto-send** |

## Architecture

1. User submits concierge prompt on `#/desktop`.
2. `resolveConciergePlan()` gathers app catalog + recent workspaces + model binding.
3. One non-streaming LLM call returns JSON (`app_id`, `seed`, `mode_id`, `workspace_index`, `auto_run`, `settings_section`).
4. Plan validates and maps to `LaunchOptions`; on failure → `routeIntent()` keyword fallback.
5. `launchApp(appId, options)` → `app-host` opens the target app with full options.

## Key modules

| File | Role |
|------|------|
| `src/os/concierge-agent.ts` | `resolveConciergePlan()`, validation, fallback |
| `src/os/concierge-prompt.ts` | System prompt + few-shot examples |
| `src/os/concierge.ts` | Async submit UX (`Understanding…` → `Opening {app}…`) |
| `src/os/code-launch.ts` | Workspace switch + `createChatWithMode` + `sendMessageWithTools` |
| `src/os/types.ts` | Extended `LaunchOptions` + `AppInstance.launchOptions` |

## LaunchOptions

```typescript
interface LaunchOptions {
  seed?: string;
  settingsSection?: string;
  modeId?: ModeId;           // Code app composer mode
  workspacePath?: string;    // Code app workspace (absolute)
  autoRun?: boolean;         // Research: start run immediately
}
```

## App behavior

- **Research:** `openResearch({ seed, autoRun })` — respects explicit `autoRun` from planner.
- **Code:** `applyCodeLaunchOptions()` — optional workspace switch; auto-send only when `autoRun === true` and a refined seed is present. Navigation-only prompts (e.g. "let's code in our finance app") open the workspace without sending the raw concierge text — see `concierge-seed.ts`.
- **Chat:** unchanged — `openChatApp(seed)` auto-sends on empty history.
- **Settings:** passes `settingsSection` when present.
- **Bench / Experts:** open app only (v1).

## Tests

- `test/os/concierge-agent.test.mts` — JSON validation, workspace index, LLM port, fallback
- `test/os/code-launch.test.mts` — workspace switch + debug chat creation
- `test/os/router.test.mts` — `launchOptions` including `autoRun`

## Out of scope (follow-ups)

- Benchmark/Experts seed prefill
- `ask_question` disambiguation for ambiguous workspace match
- Full multi-tool concierge sub-agent loop
- Server-side `/api/os/concierge` endpoint

## Todos (implementation)

- [x] Extend LaunchOptions + AppInstance
- [x] Implement resolveConciergePlan()
- [x] Async concierge UI
- [x] applyCodeLaunchOptions()
- [x] Wire app-host launch paths
- [x] Unit tests
- [x] Documentation
