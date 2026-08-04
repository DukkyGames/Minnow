# Pre-beta copy review — Minnow

## Executive summary

Overall copy is **beta-appropriate** in onboarding welcome and README (explicit WIP, feedback channels, no over-promising on hidden apps in marketing tables). **No Reef mode references** were found under `src/chat/prompts/`.

The largest risks are **model-facing prompt and tool metadata** that disagree with `documentation/context.md` and release gating: onboarding teaches the assistant about **hidden apps** (Experts, Email, Calendar) and an outdated **tool count**; `launch_minnow_app` prompts and tool descriptions steer users/models toward **Bench/Experts**; **Research** is described as a mode handoff via `set_chat_mode` even though Research is an **app**, not a `ModeId`; **Debug** prompts say work happens “not from chat composer modes” while the user is literally in **Debug** composer mode; **Plan** prompts say “no shell” while Plan’s tool groups include **code-exec** (MIN-332 matrix).

User-visible UI strings are mostly clean: **no MIN-xxx in UI text** (only code comments), **no lorem**, consistent **Coming soon** for optional apps. Remaining UI issues are **internal codenames** (CORTEX wiki), **developer jargon** in tool errors (`npm start`, `TOOLS_ALLOW_ALL_PATHS`), and **bug vs issue** terminology drift.

---

## Issues by category

### Prompts

| Severity | Location | Current snippet | Problem | Recommended replacement |
|----------|----------|-----------------|---------|-------------------------|
| **High** | `src/chat/prompts/modes/onboarding.full.md` (~42–43) | `~88 built-in tools` … **Experts** … `email, calendar, and models management` | Tool count and app list disagree with context (114 built-in / 106 default exposed; 8 released core apps include Issues, Scheduler; Experts/Email/Calendar are **hidden**) | e.g. `100+ built-in tools (MCP adds more)`; list **Chat, Code, Research, Models, Brain, Issues, Scheduler, Settings**; omit hidden apps or say they are not in this release |
| **High** | `src/chat/prompts/modes/onboarding.full.md` (~43) | `Debug hunts bugs` | Debug mode is **Issues/issue_*** oriented; “bugs” is legacy | `Debug investigates and fixes issues (Issues app + issue_* tools)` |
| **High** | `src/chat/prompts/modes/debug.full.md` (~15–17) | `not from chat composer modes` | User is in **Debug** composer mode; model may tell users to leave the mode they are already using | e.g. `You are in Debug mode in chat; use issue_* tools and the Issues app for tracker workflows` |
| **High** | `src/chat/prompts/modes/general.lite.md` (~19) | handoff **Research** via `set_chat_mode` | **Research is not a `ModeId`**; handoff should use `launch_minnow_app` (`research`) per context | e.g. `Offer Build / Plan / Orchestrate via propose_mode_switch or set_chat_mode; for deep research offer launch_minnow_app → research` |
| **High** | `src/chat/prompts/tool-usage/mode-handoff.md` (~19, 24) | Offer **Switch to Research** … `set_chat_mode` for Build/Plan | Full handoff doc never says to open Research **app**; lite doc ties Research to `set_chat_mode` | Add row: Research → `launch_minnow_app` with `app_id: research` (+ seed); do not use `set_chat_mode` for research |
| **High** | `src/chat/prompts/tool-usage/mode-handoff.lite.md` (~15) | `Implement in Plan/Research → offer Build (set_chat_mode)` | “Research” is not a chat mode | Split: Plan → `set_chat_mode` build; Research app context → stay in app or open Code for implementation |
| **High** | `src/chat/prompts/tool-usage/launch-minnow-app.md` (~16–20) | `bench`, `experts` in routing table | Apps are **release-hidden**; `os-launch-tool` will error for disabled apps | Remove bench/experts from default table or add “only if enabled in Settings → Apps”; prefer `issues`, `models`, `brain`, `scheduler` where relevant |
| **High** | `src/chat/prompts/tool-usage/launch-minnow-app.lite.md` (~12) | `benchmarks → bench` | Same hidden-app issue | Drop `bench` or gate on availability |
| **Medium** | `src/chat/prompts/modes/plan.full.md` (~22) | `do not … run shell commands` | Context + `tool-groups.ts` allow **code-exec** in Plan (MIN-332); prompt contradicts enforcement | e.g. `No mutating file/git writes except plan paths; shell allowed only for read-only discovery probes` (match actual policy) |
| **Medium** | `src/chat/prompts/modes/plan.lite.md` (~27) | `No shell` | Same as above | Align with code-exec allowlist or document deny list accurately |
| **Medium** | `src/chat/prompts/modes/desktop.full.md` (~16, 20) | `email, calendar` as normal desktop capabilities | Email/Calendar apps are **hidden** by default | Qualify: “when Email/Calendar apps are enabled” or point to Settings → Apps |
| **Medium** | `src/chat/prompts/modes/email.full.md` / `email.lite.md` | Full Email mode prompts | Shipped prompts for a **hidden** app—OK for code paths, but if any surface leaks Email mode to general users, copy assumes released product | Ensure Email mode only appears when app enabled; prompt text already “review-first” (good) |
| **Medium** | `src/chat/prompts/tool-usage/manage-appearance.md` (~17) | `Requires npm start` | Model-facing dev CLI; packaged users don’t “npm start” | `Requires Minnow running locally (not Vite-only dev)` |
| **Medium** | `src/chat/prompts/tool-usage/manage-appearance.lite.md` (~15) | `uploads need npm start` | Same | `uploads need the local Minnow app running` |
| **Medium** | `src/chat/prompts/tool-usage/default.full.md` (~28) | Long-running example lists `npm start` | Conflates **user’s project** start script with **Minnow** dev | Prefer `npm run dev`, `vite`, `next dev` only (drop `npm start` as dev-server example) |
| **Low** | `src/chat/prompts/experts/_template/README.md` (~19) | `#/experts`, Settings → Experts | Contributor/docs text for hidden app | Mark as hidden / not in default product |
| **Low** | `src/chat/prompts/work-agents/ui-designer/agent.full.md` (~45) | `Bench Instrument register` | Internal design metaphor in agent prompt | `DESIGN.md instrument register` (drop “Bench”) |
| **Low** | `src/agents/defaults/sub-agents.json` (~237) | label: `Bug planner` | User may see sub-agent label in activity UI; product is **Issues** | `Issue planner` or `Fix planner` |
| **Low** | `src/chat/prompts/modes/debug.full.md` (~44) | `bug-planner` | Internal type id exposed in prompt | `issue plan` / `bug-planner sub-agent (issue plans)` with user-facing name “Issue planner” |

**Positive:** No Reef references; base security prompts (secrets, destructive commands) are clear; onboarding tour rules (no fabricated tool results, short messages) are sound.

---

### UI copy

| Severity | Location | Current snippet | Problem | Recommended replacement |
|----------|----------|-----------------|---------|-------------------------|
| **Medium** | `src/os/app-registry.ts` (~101) | `Browse and maintain the CORTEX wiki` | **CORTEX** is internal codename; shown in app picker descriptions | `Browse and maintain your local Brain wiki` |
| **Medium** | `src/tools/definitions.ts` (~1810, 1836, 1854) | `Requires npm start` (minnow_docs_* descriptions) | Surfaces in **Settings → Tools** for end users | `Requires Minnow running locally` |
| **Medium** | `src/tools/definitions.ts` (~288–294) | `Experts, Bench, Settings` … `experts lab, benchmarks (bench)` | Tool catalog text advertises **hidden** apps | List released apps; mention bench/experts only if enabled |
| **Medium** | `src/tools/permission-gate.ts` (~98) | `TOOLS_ALLOW_ALL_PATHS=1 for automation` | User-visible tool error | Drop env var; e.g. `…or enable full disk access in Settings → General → Filesystem access` |
| **Low** | `src/ui/settings-catalog.ts` (~184) | keywords include `TOOLS_ALLOW_ALL_PATHS` | Search keyword is dev-facing | Remove or replace with `full disk` |
| **Low** | `src/ui/settings-diagnostics.ts` (~227–234) | `bug cards` | Consistent with issue **type** `bug`, but “bug cards” is informal | `Issues cards (type: bug)` |
| **Low** | `src/chat/modes/registry.ts` (~75–76) | Debug description: `Investigate bugs` | Mode picker `title`/description user sees | `Investigate issues and root causes (Issues app)` |
| **Low** | `src/skills/builtin-manifest.json` (~30) | label: `Create Pr` | Casing | `Create PR` |

**Positive:** `src/copy/local-session.ts` follows MIN-529 (“Open or restart Minnow”); filesystem settings warnings are clear; placeholders are purposeful (no lorem).

---

### Onboarding

| Severity | Location | Current snippet | Problem | Recommended replacement |
|----------|----------|-----------------|---------|-------------------------|
| **Medium** | `src/onboarding/steps/apps.ts` (~60) | `More optional apps are coming soon` | Accurate for current build (no optional released) | Keep; ensure marketing doesn’t promise optional apps elsewhere |
| **Low** | `src/onboarding/steps/welcome.ts` (~48–63) | `spiraled into a full-featured workspace` / `work in progress` | Matches README; good beta tone | Optional tighten: align feature list with eight released apps |
| **Low** | `src/onboarding/steps/welcome.ts` (~15–18) | Setup preview: Appearance, Models, Permissions only | Wizard also covers apps, extras, etc. | Add one line: “Plus apps, tools, and optional integrations” |

Onboarding **lite** mode prompt (`onboarding.lite.md`) avoids the bad facts block (good); **full** onboarding mode facts block is the main problem.

---

### README

| Severity | Location | Current snippet | Problem | Recommended replacement |
|----------|----------|-----------------|---------|-------------------------|
| **Low** | `README.md` (~14) | `still a work in progress` | Honest for beta | Optional: add “public beta” if that’s the release label |
| **Low** | `README.md` (~31) | `desktop window opens on http://localhost:9473` | Dev-from-source framing; installers don’t use localhost | Split: “Dev: localhost:9473” vs “Installer: desktop app” |
| **Low** | `README.md` (~39) | `All of it is built in and always on` | Strictly true for **released** surfaces; hidden apps exist in tree | `Core apps are always on; optional apps ship when released` |
| **Positive** | `README.md` (~67–68, 121–137) | Eight apps table includes Issues, Scheduler | Matches `context.md` / MIN-471 gating story |

---

### Skills

| Severity | Location | Current snippet | Problem | Recommended replacement |
|----------|----------|-----------------|---------|-------------------------|
| **Low** | `src/skills/builtin-manifest.json` | `Create Pr` label | UI casing | `Create PR` |
| **Low** | `src/skills/builtin-manifest.json` | `debug-error`: `Error messages` | Capital E in description mid-sentence | `error messages` |
| **Low** | `src/skills/builtin-manifest.json` | `caveman` ~75% token claim | Unverifiable marketing in skill description | Softer: `shorter, caveman-style replies` |
| **Positive** | Builtin descriptions | Generally actionable, match slash commands | — | — |

Library index JSON changes in git status were not fully audited; builtin manifest above is the shipped user-facing catalog.

---

### Settings (labels, hints, beta channel)

| Severity | Location | Current snippet | Problem | Recommended replacement |
|----------|----------|-----------------|---------|-------------------------|
| **Low** | `src/ui/settings-updates.ts` (~34) | `Beta builds may be less stable` | Appropriate beta disclaimer | Keep |
| **Low** | `src/ui/settings-updates.ts` (~31) | `Updates apply to the installed Minnow app, not this dev session` | Clear for contributors | Keep |
| **Low** | `src/ui/settings-catalog.ts` (~147) | `Beta pre-releases for auto-update` | Matches product | Keep |
| **Low** | `src/ui/settings-apps.ts` (~50) | `Optional apps will appear here when they ship` | Consistent with coming-soon empty state | Keep |

---

### Error messages (user-visible)

| Severity | Location | Current snippet | Problem | Recommended replacement |
|----------|----------|-----------------|---------|-------------------------|
| **Medium** | `src/tools/permission-gate.ts` (~98) | `TOOLS_ALLOW_ALL_PATHS=1` | Dev env var in chat tool result | Remove env var sentence |
| **Low** | `src/tools/mode-handoff-tools.ts` (~128) | `mode_id must be one of: general, desktop, plan, build, orchestrate` | Raw internal ids in chat | Optional: map to labels (“Build”, “Plan”, …) |
| **Positive** | `src/tools/os-launch-tool.ts` (~75–77) | `turned off. Enable it in Settings → Apps` | Good gating message for hidden apps | Use as pattern elsewhere |
| **Positive** | `src/copy/local-session.ts` | `Open or restart Minnow` | Aligns with MIN-529 | Extend pattern to any remaining `npm start` in **tool descriptions** |

---

## Terminology inconsistencies (glossary)

| Term A | Term B | Where | Recommendation |
|--------|--------|-------|----------------|
| **Issues** (app, `issue_*`) | **bugs**, **bug cards**, **Bug planner** | Onboarding facts, Debug registry description, diagnostics, sub-agent labels | User-facing: **Issues**; type `bug` OK inside Issues taxonomy |
| **Orchestrate** (mode) | **Orchestrator boards** (README) | README vs mode picker | Pick one customer name; README “Orchestrator boards” is fine if UI stays “Orchestrate” |
| **Research** (app) | **Research mode** | `general.lite.md`, mode-handoff | **App only** — never `set_chat_mode('research')` |
| **Debug** (composer mode) | **Issues-only workflows** | `debug.full.md` “not from composer modes” | Debug **is** a composer mode; Issues app is the tracker surface |
| **Brain wiki** | **CORTEX wiki** | `app-registry.ts` | **Brain** only publicly |
| **114 tools** (README/context) | **~88 tools** (onboarding prompt) | README vs onboarding.full | **106 exposed** default build; say “100+” or cite 106/114 with MCP/gating footnote |
| **npm start** | **Open/restart Minnow** | Tool defs, appearance prompts | User copy: local app running; `npm start` only in contributor docs |
| **Plan: no shell** | Plan allows **code-exec** | plan.*.md vs `tool-groups.ts` | Single sentence on allowed probes vs forbidden writes |
| **Eight apps** | Hidden Compare/Bench/Experts/Calendar/Email | Registry vs prompts/README | Hidden = not product; don’t route or teach in onboarding |

---

## Beta blockers (recommended fix before wide beta)

1. **Onboarding assistant facts** (`onboarding.full.md`): wrong tool count, hidden apps (Experts, Email, Calendar), and “Debug hunts bugs” — first-run model will mis-teach the product.
2. **Research routing**: `general.lite.md` + `mode-handoff.lite.md` imply `set_chat_mode` for Research — **broken handoff** (Research is an app).
3. **Hidden app routing in prompts/tools**: `launch-minnow-app.md` / lite + `launch_minnow_app` tool description enum/narrative for **bench/experts** without matching release gating (runtime errors are OK but assistant will keep offering them).
4. **Debug mode prompt contradiction** (“not from chat composer modes”) — confuses both users and models in Debug mode.
5. **Brain app description “CORTEX wiki”** — visible codename in app metadata (`app-registry.ts`).
6. **Plan mode shell instructions** vs actual **code-exec** allowlist — models will avoid useful probes or hit policy surprises (support burden).

**Not blockers but ship soon:** `minnow_docs_*` and permission-gate error strings still say `npm start` / `TOOLS_ALLOW_ALL_PATHS`; README “all built in and always on” slight overstatement.

---

## Factual cross-check vs `documentation/context.md`

| Topic | context.md | Copy reviewed | Match? |
|-------|------------|---------------|--------|
| Composer modes | General, Build, Plan, Debug + Orchestrate hub, Super Plan, Desktop, Email, Onboarding | Prompts mostly OK; Research **not** a mode | Partial — handoff copy wrong for Research |
| Reef removed | MIN-473 | No Reef in prompts | Yes |
| Released apps | 8 core released | README OK; onboarding.full lists hidden apps | No |
| Tool count | 114 / 106 exposed | README 114; onboarding ~88 | No |
| Hidden apps | Compare, Bench, Experts, Calendar, Email | Prompts/tools still mention several | No |
| Plan shell | Allowed per matrix | plan prompts say no shell | No |
| Local session copy | MIN-529 phrasing | `local-session.ts` | Yes |

---

*Review performed read-only; no files modified.*

[REDACTED]