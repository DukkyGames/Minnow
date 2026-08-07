---
name: plan-work
label: Plan Work
description: >-
  Produces implementation plans in documentation/plans/ through discovery,
  codebase research via sub-agents, and a review pass before handoff. The lead
  agent does not write product code. Use when the user asks for a plan, roadmap,
  phased breakdown, implementation spec, or to plan a feature before building;
  pair with orchestrate-plan for execution.
disable-model-invocation: true
---

# Plan work (discover → draft → review)

You are the **planner**. Your deliverable is a **durable plan document** under `documentation/plans/`, ready for humans and for the **orchestrate-plan** skill (`/orchestrate-plan`).

## Hard rules (planner)

| Allowed | Forbidden |
|---------|-----------|
| Read the repo, `documentation/context.md`, `AGENTS.md`, `DESIGN.md`, issues | Edit product code (`src/`, `server/`, `electron/`, tests, configs outside plans) |
| Write or update files under `documentation/plans/` and `documentation/plans/references/` | Implement the feature “while planning” |
| Delegate via **`spawn_sub_agent`** (`wait: true` for research and review gates) | Skip user alignment on ambiguous scope |
| Use **`ask_question`** or **`/ask-user`** for decisions the user must own | Produce phases that cannot be verified (no tests, URLs, or acceptance checks) |

If requirements are still fuzzy, run discovery first — do not invent locked decisions.

## Sub-agent mechanics (Minnow)

Use **`spawn_sub_agent`** (types below). For planning gates, set **`wait: true`** so you receive the summary in the tool result before drafting or finalizing. Do **not** poll `list_sub_agents` in a loop. Sub-agents **cannot** spawn further sub-agents — keep each task brief self-contained.

| Goal | `type` |
|------|--------|
| Read-only codebase map | `explore` |
| Web + repo research | `researcher` |
| Plan review or isolated analysis | `generalPurpose` |

For planning gates, set **`wait: true`** so you receive the summary in the tool result before drafting or finalizing. Do **not** poll `list_sub_agents` in a loop. Sub-agents **cannot** spawn further sub-agents — keep each task brief self-contained.

## Workflow checklist

```
Plan work:
- [ ] 1. Intake + interview (or confirm user opt-out)
- [ ] 2. Read authoritative docs + prototype/ (if any)
- [ ] 3. Research sub-agent(s) — codebase / constraints
- [ ] 4. Draft plan (template + phase table with verify hooks)
- [ ] 5. Review sub-agent — plan quality gate
- [ ] 6. Revise + present handoff to user (or /orchestrate-plan)
```

---

## Step 1: Intake and interview

1. Restate the goal in one sentence.
2. If scope, priority, MVP, or success criteria are missing, interview before planning. Prefer **`/ask-user`** or **`ask_question`** when the user listed multiple features or a vague slice.
3. Stop interviewing when **priority, MVP scope, and success criteria** are clear, or the user says **“skip questions”** — then label **Assumptions** in the plan.

Capture agreed context in `documentation/plans/references/<slug>-context.md` when the interview is non-trivial.

---

## Step 2: Read before you delegate

Always read (at least skim):

- `documentation/context.md` for subsystems you will touch
- `AGENTS.md` for repo conventions
- **`prototype/`** at repo root if it exists (build spec / UI prototype)
- Existing plans that overlap (`documentation/plans/`)

Note **locked decisions already in code** (do not re-litigate without flagging).

---

## Step 3: Research sub-agents

Delegate investigation; do not dump the codebase into the main thread.

| Need | Sub-agent `type` |
|------|------------------|
| Where code lives, APIs, tests | `explore` |
| External docs + repo depth | `researcher` |
| Threat-model questions only | `explore` or `generalPurpose` |

Call `spawn_sub_agent` with **`wait: true`**. Summarize findings into the plan’s **Context** and **Architecture / key files** sections.

Templates: [prompt-templates.md](prompt-templates.md)

---

## Step 4: Draft the plan

1. Choose a **slug** (`kebab-case`, issue id prefix if applicable): `documentation/plans/<slug>.md`.
2. Follow [plan-template.md](plan-template.md).
3. Every **phase** must include:
   - **Goal** (one paragraph)
   - **In / out of scope** for that phase
   - **Verification** — exact commands (`npm test`, `npx tsc --noEmit`, scoped suite), and for UI: route + `browser_*` criteria
   - **Orchestration hints** — `explore` vs `generalPurpose`, **Impeccable** + **browser-automation** when UI

### Phase sizing (for later orchestration)

Phases should match one implement + one verify sub-agent run (see **orchestrate-plan**).

### UI-heavy work

Tag UI phases explicitly:

- Implement: **`/impeccable`**
- Verify: **`/browser-automation`** (`browser_navigate`, `browser_snapshot`, `browser_screenshot`)

### Todos table

Include a **Todos** section with stable phase ids (`phase-0-…`) and status — the orchestrator updates this during execution.

---

## Step 5: Review sub-agent (mandatory)

Before calling the plan final, spawn **`generalPurpose`** with **`wait: true`** to review the **plan markdown** only (not product code).

Reviewer rubric:

- [ ] Locked decisions and non-goals are explicit
- [ ] Each phase has verifiable acceptance criteria
- [ ] Order respects dependencies
- [ ] Files/areas named are plausible (spot-check paths)
- [ ] Risks, rollout, and `documentation/context.md` update called out if APIs/architecture change
- [ ] UI phases name Impeccable + browser verification

**VERDICT: PASS** → present to user. **FAIL** → revise once; re-run review if large gaps remain.

Prompt template: [prompt-templates.md](prompt-templates.md)

---

## Step 6: Handoff

Tell the user:

- Plan path(s)
- Recommended next step: **`/orchestrate-plan`** and execute phase-by-phase
- Any decisions still open (short list)

Do not start orchestration unless the user asks.

---

## Escalation

Ask the user when:

- Research contradicts the stated goal (missing APIs, platform blockers)
- Scope needs a product call (security vs UX, MVP cut)
- Two review FAIL cycles on the same draft

---

## Additional resources

- Plan file skeleton: [plan-template.md](plan-template.md)
- Research/review prompts: [prompt-templates.md](prompt-templates.md)
- Execution: [orchestrate-plan](../orchestrate-plan/SKILL.md)
