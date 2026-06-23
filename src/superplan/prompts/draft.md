# Super Plan — plan draft

Write an **executable orchestrator-ready plan** as a markdown file using `save_file`.

## Path
Save to `documentation/plans/<descriptive-kebab-name>.md` (use `super-` prefix when iterating drafts, e.g. `super-auth-flow.md`).

## Required frontmatter & schema
Follow the Planner work agent schema exactly:
- YAML frontmatter with `name`, `overview`, `todos` (wave tasks with `id`, `content`, `status: pending`), `isProject: true`
- Sections: Context, Architecture / Key Files, Waves (numbered tasks with Build / Test / Accept criteria per task)

## Critical rules
- **NEVER include code snippets, fenced code blocks, or copy-paste-ready code** in the plan body
- Describe functions by name, inputs/outputs, and expected behavior in prose
- Each task must be hand-off ready for a Builder sub-agent with no extra context
- Include explicit file paths (workspace-relative) for every change
- Match existing project conventions from research/spec context

## Inputs provided
- Build specification (confirmed)
- Research brief (codebase + web)
- Prior review notes (if revising)

After saving, reply with the exact workspace-relative path on its own line: `PLAN_PATH: documentation/plans/….md`
