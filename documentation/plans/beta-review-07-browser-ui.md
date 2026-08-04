# Pre-beta browser UI review — Minnow

**Reviewer:** Live pass via cursor-ide-browser (coordinator); sub-agent [Browser UI beta walkthrough](813886c1-2148-4833-a84f-7f0e59008d56) stalled after reading skill file.  
**Environment:** `http://localhost:9474/#/…` (dev server; port 9473 was in use), **browser tab** (not Electron shell), viewport ~desktop from screenshot (~1280×800).  
**Date:** 2026-08-03

## Executive summary

Core shell is **usable and visually coherent**: desktop chat, dock, Issues app, Settings, and Apps menu show the **eight released apps** only. **No Compare, Bench, Calendar, or Email** appeared in the dock or Apps launcher.

**Beta blockers in UI:** Settings still exposes **Experts** (toggle, region, and tool copy referencing Experts/Bench) while the Experts app is `releaseState: 'hidden'`. Settings **Tools** copy still says **`npm start`** in multiple places. Tool description visible in settings tree mentions **Experts, Bench** in the `launch_minnow_app` blurb.

**Not verified in this pass:** Electron-only flows (`browser_*`, packaged auto-update, onboarding wizard from fresh profile, Orchestrate board, full responsive matrix — resize tool unavailable in MCP).

---

## Screens tested checklist

| Screen | Route / entry | Result | Notes |
|--------|----------------|--------|--------|
| Desktop chat | `#/desktop` | **Pass** | Greeting, composer, model selector, dock |
| Issues (list) | Dock → Issues | **Pass** | List/Board toggle, filters, “14 open” sample data |
| Apps launcher | Top **Apps** | **Pass** | Desktop, Code, Research, Models, Brain, Scheduler, Issues, Settings only |
| Settings | Top gear | **Pass** | Large settings tree loads |
| Hidden apps in dock | Visual scan | **Pass** | No Compare/Bench/Experts/Calendar/Email buttons |
| Experts in Settings | Settings search tree | **Fail** | “Enable experts”, Experts region, flask copy |
| Mobile / narrow | `browser_resize` | **Skip** | MCP resize not available |
| Onboarding | Fresh install | **Skip** | Existing `~/.minnow` profile |
| Orchestrate | Sidebar hub | **Skip** | Not exercised this session |
| Code / Research / Brain / Scheduler | Dock | **Skip** | Spot-check only via Apps menu presence |

---

## Visual bugs

| ID | Severity | Repro | Description |
|----|----------|-------|-------------|
| UI-V-01 | Low | Desktop with long user paste in composer | Composer shows full multi-line user query from session history (expected); no layout break observed |
| UI-V-02 | — | — | No overlapping chrome or clipped dock in screenshot |

---

## Accessibility (snapshot)

| ID | Severity | Finding |
|----|----------|---------|
| UI-A-01 | Low | Duplicate **Scheduler** / **Settings** names in tree (top bar + dock) — distinguishable by context but same accessible name |
| UI-A-02 | Info | Issues main landmark present (`role: main`, name Issues) |
| UI-A-03 | Medium | Experts controls exposed in settings tree while app is release-hidden — confusing for screen reader users |

---

## Console / network

| Check | Result |
|-------|--------|
| Console tool | Not invoked (no `browser_console_messages` in namespace) |
| Provider errors | Header showed **Ready**; model **Deepseek v4 flash · OpenCode Go** selected |
| API ping | Dev server started; APIs listed on 9474 |

**Recommendation:** Run manual smoke with DevTools on packaged Electron; watch `/api/providers` and tool server pings on first launch without LM Studio.

---

## Copy issues spotted in UI

| Severity | Location | Text | Issue |
|----------|----------|------|--------|
| **High** | Settings → Experts | “When enabled, summon specialists from Experts (top bar flask icon)” | Experts app hidden — UI should not advertise flask / Experts lab |
| **High** | Settings → Tools (launch app tool) | “Code, Chat, Research, **Experts**, **Bench**, Settings” | Hidden apps in user-visible tool description |
| **Medium** | Settings → Tools | “Server tools require **npm start**” | Dev jargon (matches copy report) |
| **Medium** | Settings → Tools / Tavily | “Stored in ~/.minnow/tools.json when **npm start** is running” | Same |
| **Low** | Prompt preset list | “Inference benchmarking” preset | OK for Models app; ensure not confused with hidden Bench app |

---

## Release gating (hidden apps)

| App | In dock / Apps menu | Elsewhere |
|-----|---------------------|-----------|
| Compare | Not seen | Not tested via `#/compare` hash |
| Bench | Not seen | Mentioned in tool description |
| Experts | Not in dock | **Settings Experts section visible** |
| Calendar | Not seen | — |
| Email | Not seen | — |

---

## Beta blockers (UI)

1. **UI-Experts** — Remove or gate Settings Experts block and related tool copy when `!isDeveloperReleased('experts')`.
2. **UI-Launch-tool-copy** — Filter Bench/Experts from `launch_minnow_app` description in Settings tools list.
3. **npm start strings** — Replace with “Minnow running locally” in Settings tool help (see copy report).

---

## Handoff for fix agent

**Files likely involved:** `src/ui/settings-*.ts`, `src/tools/definitions.ts`, `src/os/app-registry.ts` (Brain description), experts settings module, `settings-prompts-hub.ts`.

**Verify after fix:** Fresh browser profile → Settings search “Experts” should not appear; Apps menu unchanged; `launch_minnow_app` in Settings → Tools shows only released app IDs.

**Full app QA:** Complete `documentation/guides/release-e2e-testing.md` Smoke tier on **packaged Electron** (browser-only pass cannot validate `browser_*` or updater).
