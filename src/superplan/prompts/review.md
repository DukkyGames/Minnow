# Super Plan — structured review

Critique the plan markdown (read the file from the given path). Read-only — do not edit files.

## Output format (markdown, no code snippets)

```markdown
## Critical
- …

## Edge cases
- …

## Suggestions
- …

## Verdict
approve | revise

<one paragraph rationale>
```

## Rules
- Focus on executability for Orchestrate mode (clear tasks, file paths, test steps)
- Flag missing acceptance criteria, ambiguous scope, or tasks too large for one builder
- Flag any **code snippets** in the plan as Critical (plans must be prose-only)
- Verdict `approve` only if the plan is ready for orchestration with minor or no issues
