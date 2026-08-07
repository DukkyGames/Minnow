---
name: orchestrate-plan
label: Orchestrate Plan
description: >-
  Runs multi-phase plans by delegating each phase to sub-agents and gating
  progress on a dedicated verification pass after every phase. The lead agent
  does not implement product code. Use when the user asks to orchestrate a plan,
  execute a plan via sub-agents, delegate phases, or run plan-and-verify loops.
disable-model-invocation: true
---

# Orchestrate plan (delegate + verify)

You are the **orchestrator**. Your job is to run an existing plan phase-by-phase, assign work to sub-agents, and **never implement product code yourself**.

Pair with **plan-work** (`/plan-work`) when no plan file exists yet.

## Hard rules (orchestrator)

| Allowed | Forbidden |
|---------|-----------|
| Read files, search the repo, read `documentation/context.md` | Edit application/source code (`src/`, `server/`, `electron/`, tests you did not delegate, etc.) |
| Update the **plan document** (checkboxes, phase status, notes) under `documentation/plans/` | Run mutating shell commands (install, build fixes, `git commit`) unless the user explicitly asks you to commit |
| **`spawn_sub_agent`** with **`wait: true`** for each implement and verify gate | Paste large file contents into the main thread — summarize sub-agent returns |
| **`ask_question`** for blocking decisions | Skip verification between phases |
| Synthesize status for the user | Rely on sub-agents to spawn further sub-agents (they cannot) |

If you catch yourself about to “just fix this one line,” stop and delegate instead.

## Sub-agent mechanics (Minnow)

| Goal | `type` |
|------|--------|
| Read-only discovery phase | `explore` |
| Implementation / docs / tests for one phase | `generalPurpose` |
| Shell-only automation | `shell` |

**Gating:** For every phase, call `spawn_sub_agent` twice in order — **implement**, then **verify** — each with **`wait: true`**. Do not poll `list_sub_agents` / `get_sub_agent_status` in a loop.

See [prompt-templates.md](prompt-templates.md) for task bodies.

## Workflow checklist

```
Orchestrate plan:
- [ ] 1. Intake plan (file or user outline) + success criteria
- [ ] 2. Confirm phases from plan todos (each independently verifiable)
- [ ] 3. For each phase: Implement sub-agent → Verify sub-agent → gate
- [ ] 4. Update plan doc + brief user summary
```

---

## Step 1: Intake

1. Locate the plan: user message, `documentation/plans/<name>.md`, or issue `planPath`.
2. Extract **locked decisions**, **out of scope**, and **done means** (tests, manual steps, URLs).
3. If the plan is vague, ask up to 3 clarifying questions before delegating.

Use the plan’s **Todos** table; do not invent a parallel task list unless the plan has none.

---

## Step 2: Phase types

| Type | Implement `type` | Verify focus |
|------|------------------|--------------|
| Discovery | `explore` | Read-only findings match phase goal |
| Implementation | `generalPurpose` | Tests, typecheck, diff scope |
| UI / visual | `generalPurpose` + **`/impeccable`** | **`/browser-automation`** tools |
| Docs-only | `generalPurpose` | Spot-read + link check |
| Optional deep review | — | **`/security-review`** or **`/code-review`** on the phase diff (user-requested; not a substitute for functional verify) |

---

## Step 3: Per-phase loop (mandatory)

Do not start phase N+1 until verification **PASS** or the user accepts risk.

### 3a. Implement sub-agent

`spawn_sub_agent` → `type: generalPurpose` (or `explore` for discovery), **`wait: true`**.

Task must include:

- **Phase goal** (one paragraph)
- **In scope / out of scope** for this phase only
- **Files or areas** to touch (if known)
- **Verification expectations** for the verifier
- Instruction to return: Summary, Files changed, Commands run, Handoff for verifier

### 3b. Verify sub-agent

Fresh `generalPurpose` sub-agent, **`wait: true`**, verification-only.

- Must **not** add features; minimal fixes only if a trivial break blocks verification
- Run checklist from the plan (commands, diff review, browser pass)
- End with **`VERDICT: PASS`** or **`VERDICT: FAIL`** plus evidence

On **FAIL**: one implement retry with failure evidence, then escalate to the user.

On **PASS**: mark the phase done in the plan doc and continue.

---

## UI phases (Impeccable + browser)

**Implement sub-agent** must follow **`/impeccable`** and project tokens (`DESIGN.md`, `--mn-*`).

**Verify sub-agent** must follow **`/browser-automation`**:

1. `browser_list` / `browser_navigate` to the route or URL from the plan
2. `browser_snapshot` + `browser_screenshot` on the changed view
3. Compare against plan acceptance criteria

Electron-only surfaces: document what was checked and what needs manual QA if preview tools cannot reach the surface.

---

## Communication

After each phase, short update: phase name, pass/fail, 2–5 bullets, next step or blockers.

When complete, summarize outcomes and deferred items.

---

## Escalation

Stop and ask the user when:

- Two failed verify → implement cycles on the same phase
- Plan conflicts with repo reality
- Verification needs secrets, hardware, or manual-only steps
- Scope creep would merge phases — split or send back to **plan-work**

---

## Additional resources

- Task templates: [prompt-templates.md](prompt-templates.md)
- Authoring plans: [plan-work](../plan-work/SKILL.md)
