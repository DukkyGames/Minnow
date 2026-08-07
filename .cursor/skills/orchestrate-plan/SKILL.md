---
name: orchestrate-plan
description: >-
  Runs multi-phase plans by delegating each phase to sub-agents and gating
  progress on a dedicated verification pass after every phase. The lead agent
  does not implement product code. Use when the user asks to orchestrate a plan,
  execute a plan via sub-agents, delegate phases, or run plan-and-verify loops.
---

# Orchestrate plan (delegate + verify)

You are the **orchestrator**. Your job is to break work into phases, assign each phase to a sub-agent, and **never implement product code yourself**.

## Hard rules (orchestrator)

| Allowed | Forbidden |
|---------|-----------|
| Read files, search the repo, read `documentation/context.md` | Edit application/source code (`src/`, `server/`, `electron/`, tests you did not delegate, etc.) |
| Update the **plan document** (checkboxes, phase status, notes) under `documentation/plans/` | Run mutating shell commands (install, build fixes, `git commit`) unless the user explicitly asks the orchestrator to commit |
| Launch **Task** sub-agents with clear prompts | Paste large file contents into the main thread — summarize sub-agent returns |
| Ask the user blocking questions via **AskQuestion** | Skip verification between phases |
| Synthesize status for the user | Spawn nested sub-agents (sub-agents cannot delegate further — keep prompts self-contained) |

If you catch yourself about to “just fix this one line,” stop and delegate instead.

## Workflow checklist

Copy and track progress:

```
Orchestrate plan:
- [ ] 1. Intake plan (file or user outline) + success criteria
- [ ] 2. Decompose into ordered phases (each independently verifiable)
- [ ] 3. For each phase: Implement sub-agent → Verify sub-agent → gate
- [ ] 4. Update plan doc + brief user summary
```

---

## Step 1: Intake

1. Locate the plan: user message, `documentation/plans/<name>.md`, or issue-linked plan path.
2. Extract **locked decisions**, **out of scope**, and **done means** (tests, manual steps, URLs).
3. If the plan is vague, ask up to 3 clarifying questions before delegating.

Prefer existing plan todos/tables; do not invent a parallel task list unless the plan has none.

---

## Step 2: Decompose phases

Each phase must be:

- **Small enough** for one sub-agent context (one feature slice, one subsystem, or one doc pass).
- **Verifiable** with explicit commands or browser checks (not “looks good”).
- **Ordered** so later phases do not depend on unverified work.

Typical phase types:

| Type | Implement sub-agent | Notes |
|------|---------------------|-------|
| Discovery | `explore` (thoroughness: medium or very thorough) | Read-only; output is a short spec for later phases |
| Implementation | `generalPurpose` | Writes code/tests/docs as scoped |
| UI / visual | `generalPurpose` + **Impeccable** + **browser-ui-review** | See [UI phases](#ui-phases-impeccable--browser) |
| CI / test-only fix | `generalPurpose` or `ci-investigator` if logs are huge | Verifier re-runs the failing command |
| Optional deep review | `bugbot` on `uncommitted changes` | Only when user wants defect-first review; not a substitute for functional verify |

Record the phase list in the plan doc (or a short table in your first reply).

---

## Step 3: Per-phase loop (mandatory)

For **every** phase, run **two** Task sub-agents **in sequence** (`run_in_background: false`). Do not start phase N+1 until verification passes or the user accepts risk.

### 3a. Implement sub-agent

Use `Task` with `subagent_type: generalPurpose` (or `explore` for discovery).

Prompt must include:

- Absolute **Full Repository Path**
- **Phase goal** (one paragraph)
- **In scope / out of scope** for this phase only
- **Files or areas** to touch (if known)
- **Verification expectations** the *next* agent will use (tests, routes, screenshots)
- Instruction: **complete the phase in this run**; return a structured summary (files changed, commands run, risks)

Templates: [prompt-templates.md](prompt-templates.md)

### 3b. Verify sub-agent

Use `Task` with `subagent_type: generalPurpose` (fresh agent, verification-only).

The verifier **must not** implement new features. It may make **minimal** fixes only if a trivial break blocks verification (document any fix in the summary).

Verifier prompt must include:

- Same repository path
- **What was supposed to change** (from implement summary)
- **Checklist** — run commands, read diffs, UI browser pass if applicable
- **Pass/fail** with evidence (command output excerpts, screenshot description, blocker list)

If verification **fails**: send implement sub-agent a **retry** prompt with failure evidence (one retry per phase by default; then escalate to the user).

If verification **passes**: mark the phase done in the plan doc and proceed.

---

## UI phases (Impeccable + browser)

When a phase touches UI, layout, styling, or UX copy:

**Implement sub-agent** must:

1. Read and follow the **Impeccable** skill (project: `.agents/skills/impeccable/SKILL.md` or user-global impeccable).
2. Ship production-grade UI per project tokens (`DESIGN.md`, `--mn-*` in Minnow).
3. State the **URL or route** and how to start the dev server if not already running.

**Verify sub-agent** must:

1. Read **browser-ui-review** (`~/.cursor/skills/browser-ui-review/SKILL.md` or attached).
2. Use **cursor-ide-browser** MCP: tabs → navigate → lock → screenshot + snapshot → console (and network if data-driven) → unlock.
3. Confirm visual + structural acceptance criteria from the plan (responsive spot-check if relevant).

If Electron/shell is required and browser MCP cannot reach the surface, verifier documents what was checked and what needs manual QA.

---

## Orchestrator communication

After each phase, post a **short** update to the user:

- Phase name and pass/fail
- 2–5 bullet facts (not a full diff)
- Next phase or blockers

When the full plan completes, summarize outcomes and any deferred items.

---

## Escalation

Stop and ask the user when:

- Two failed verify → implement cycles on the same phase
- Plan conflicts with repo reality (missing APIs, wrong assumptions)
- Verification needs secrets, hardware, or manual steps only the user can do
- Scope creep would merge multiple phases — split or re-plan

---

## Additional resources

- Sub-agent prompt templates: [prompt-templates.md](prompt-templates.md)
