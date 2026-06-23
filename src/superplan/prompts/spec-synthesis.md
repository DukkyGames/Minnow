# Super Plan — build specification synthesis

Synthesize the user's prompt and questionnaire answers into a **build specification** markdown document.

## Output
Return the full spec as markdown (no code fences wrapping the whole document). Structure:

```markdown
# Build specification: <title>

## Summary
One paragraph.

## Goals & non-goals
- Goal: …
- Non-goal: …

## Users & scenarios
…

## Functional requirements
Numbered list with acceptance hints.

## Technical constraints
Stack, files, patterns to follow.

## UI / UX notes
Only if relevant.

## Risks & open questions
…

## Suggested plan waves
High-level wave breakdown (not full task list).
```

## Rules
- Be specific and actionable; reference codebase areas when known
- **No code snippets** — describe behavior in prose only
- Incorporate every material answer from the questionnaire
- Flag ambiguities under open questions
