# Plan template

Copy into `documentation/plans/<slug>.md` and replace placeholders.

```markdown
# <Title> — <short subtitle>

**Status:** Draft | Ready | In progress | Done
**Linear / issue:** <link or MIN-###>
**Related:** <plans, tickets>
**Date:** YYYY-MM-DD

---

## Locked product decisions

- <decision>
- **Non-goals:** <explicit out of scope>

---

## Success criteria (definition of done)

- <measurable outcome>
- <tests or commands that must pass>
- <manual / browser checks if any>

---

## Assumptions (if interview skipped or partial)

- <assumption>

---

## Todos (execution tracking)

| ID | Phase | Status |
|----|-------|--------|
| phase-0-<slug> | <title> | Pending |
| phase-1-<slug> | <title> | Pending |

---

## Context

<Why now, current behavior, gap, links to context.md sections>

---

## Architecture / key files

| File / area | Role | Expected action |
|-------------|------|-----------------|
| `path` | | MODIFY / READ / NEW |

---

## Phases

### Phase 0 — <title>

**Goal:** <one paragraph>

**In scope:**
- 

**Out of scope:**
- 

**Implementation notes:** <optional technical detail>

**Verification (orchestrate verify sub-agent):**
- [ ] `<command>`
- [ ] UI: route `#/...` — `browser_snapshot` + `browser_screenshot`

**Orchestration:** `explore` | `generalPurpose` | UI: `/impeccable` + `/browser-automation`

---

### Phase 1 — <title>

(repeat structure)

---

## Risks and rollback

| Risk | Mitigation |
|------|------------|
| | |

---

## Documentation follow-up

- [ ] Update `documentation/context.md` if architecture/APIs/storage change
- [ ] User manual / keyboard shortcuts / settings copy (if user-facing)

---

## Open questions

- <question for user, if any>
```
