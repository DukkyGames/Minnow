# Orchestration sub-agent task templates

Use as the **`task`** string for `spawn_sub_agent` with **`wait: true`**. Tasks must be self-contained (sub-agents cannot spawn children).

---

## Implement phase (`generalPurpose`)

```text
Role: Phase implementer for a multi-phase plan. You write the code/docs/tests for THIS phase only.

Plan: <plan file path>
Phase: <phase id and title>
Goal: <what done looks like>

In scope:
- <bullet>

Out of scope (do not touch):
- <bullet>

Context:
- <locked decisions, related files, conventions>

Requirements:
- Follow AGENTS.md and documentation/context.md for this area.
- Run relevant tests before finishing; fix failures you introduced.
- Return:
  ## Summary
  ## Files changed
  ## Commands run (with pass/fail)
  ## Risks / follow-ups
  ## Handoff for verifier
  (exact commands, URLs, routes, expected behavior)
```

### Implement — UI (add to Requirements)

```text
- Follow the Impeccable skill (/impeccable) before editing UI.
- Use DESIGN.md and --mn-* tokens; no ad-hoc hex outside tokens.css (Minnow).
- State the route/URL and how to view the change in the Minnow preview browser.
```

### Discover phase (`explore`)

```text
Role: Read-only discovery for plan phase "<title>".

Questions:
1. <question>
2. <question>

Do not edit files. Return:
## Findings
## Recommended follow-ups
## Files to read next
## Risks
```

---

## Verify phase (`generalPurpose`)

```text
Role: Phase verifier. Do NOT implement new features.

Phase: <phase id and title>
Implementer handoff:
<paste Handoff section>

Verification checklist:
- [ ] <test command>
- [ ] npx tsc --noEmit (if TS touched)
- [ ] Diff matches phase goal; no scope creep
- [ ] UI: browser_navigate + browser_snapshot + browser_screenshot on <route/URL>

Rules:
- Minimal fixes only if required to verify; list them separately.
- End with exactly: VERDICT: PASS or VERDICT: FAIL

Return:
## Checks run
## Evidence
## Minimal fixes (if any)
## VERDICT: PASS|FAIL
## If FAIL: retry instructions for implementer
```

---

## Retry implement (after FAIL)

```text
Phase retry: <phase id>
Verifier verdict: FAIL

Failure evidence:
<paste Evidence + retry instructions>

Fix failures only; do not expand scope. Re-run handoff commands and update your summary.
```

---

## Optional review skills (after functional PASS)

Only when the user asks:

- **`/code-review`** on the phase diff
- **`/security-review`** on security-sensitive changes
