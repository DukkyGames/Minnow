# Sub-agent prompt templates

Copy, fill placeholders, and pass as the Task **description** (and prompt body). Keep prompts self-contained — sub-agents cannot spawn children.

---

## Implement phase (generalPurpose)

```text
Full Repository Path: <absolute path>

Role: Phase implementer for a multi-phase plan. You write the code/docs/tests for THIS phase only.

Plan: <plan file path or one-line reference>
Phase: <phase id and title>
Goal: <what done looks like>

In scope:
- <bullet>

Out of scope (do not touch):
- <bullet>

Context:
- <locked decisions, related files, conventions>

Requirements:
- Follow existing repo style and AGENTS.md / documentation/context.md for this area.
- Run relevant tests before finishing; fix failures you introduced.
- Return a structured summary:
  ## Summary
  ## Files changed
  ## Commands run (with pass/fail)
  ## Risks / follow-ups
  ## Handoff for verifier
  (exact commands, URLs, routes, expected behavior)
```

### Implement phase — UI (add to Requirements)

```text
- Read and follow the Impeccable skill before editing UI.
- Use project design tokens and DESIGN.md; no ad-hoc hex outside tokens.css (Minnow).
- Note the dev URL/route and how to view the change for browser verification.
```

### Discover phase (explore)

```text
Full Repository Path: <absolute path>

Role: Read-only discovery for plan phase "<title>".

Questions to answer:
1. <question>
2. <question>

Thoroughness: <quick | medium | very thorough>

Do not edit files. Return:
## Findings
## Recommended phase breakdown
## Files to read next
## Risks
```

---

## Verify phase (generalPurpose)

```text
Full Repository Path: <absolute path>

Role: Phase verifier. You do NOT implement new features.

Phase: <phase id and title>
Implementer summary:
<paste implementer's Handoff section>

Verification checklist (execute all that apply):
- [ ] <test command>
- [ ] <typecheck/lint if relevant>
- [ ] Diff review: changes match phase goal; no obvious scope creep
- [ ] UI: browser-ui-review loop on <URL> (screenshot + snapshot + console)

Rules:
- If something fails, diagnose root cause.
- You may apply only minimal fixes required to complete verification; list them separately.
- End with exactly one line: VERDICT: PASS or VERDICT: FAIL

Return:
## Checks run
## Evidence
## Minimal fixes (if any)
## VERDICT: PASS|FAIL
## If FAIL: retry instructions for implementer
```

### Verify phase — UI browser block

```text
UI verification (required):
1. cursor-ide-browser: browser_tabs list
2. browser_navigate to <URL> (or confirm existing tab)
3. browser_lock lock
4. browser_take_screenshot + browser_snapshot on the changed view
5. browser_console_messages (and network if data-driven)
6. browser_lock unlock
7. Compare against plan acceptance criteria: <bullets>
```

---

## Optional: Bugbot review (after PASS functional verify)

Only when the user wants defect-first review of the branch or uncommitted work:

```text
Task subagent_type=bugbot
Description: Bugbot
Prompt:
Full Repository Path: <absolute path>
Diff: uncommitted changes
Custom Instructions: Review only changes from phase "<title>". No new features.
```

---

## Retry implement (after FAIL)

```text
Full Repository Path: <absolute path>

Phase retry: <phase id>
Verifier verdict: FAIL

Failure evidence:
<paste verifier Evidence + retry instructions>

Fix the failures only; do not expand scope. Re-run the verifier handoff commands and update your summary.
```
