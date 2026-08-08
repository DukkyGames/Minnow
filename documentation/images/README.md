# README screenshots

Drop captures here with these exact filenames and they appear in the README with no further edits.

**Note:** PNG assets in this folder still show the pre–workspace-first shell in places. Refresh them per the specs below when you next shoot; this doc is the source of truth until new files land.

| File | Shot | Where it goes |
|------|------|---------------|
| `hero.png` | **Workspaces picker** (`#/workspaces`) or **Code** with chat rail visible: menubar model chip, app rail, no modal on top. Wide 16:9. | README, top |
| `app-code.png` | Code app, real project open: file tree left, a file in the editor (syntax + a git gutter mark), chat column on the right mid-conversation with a tool call visible. Terminal tab open along the bottom if it fits. | Code section |
| `app-orchestrator.png` | Orchestrator board (Code sidebar rail → **Orchestrate**) with a multi-wave board part-run: some cards complete, one in progress, worktree/agent chips visible. | Orchestrator section |
| `app-super-plan.png` | Super Plan mid-pipeline (composer → Plan → caret): the stage stepper showing a completed stage or two, current stage active, draft content on screen. | Super Plan section |
| `app-brain.png` | Brain, full stage, **Graph** section: the graph itself filling the canvas with a decent node count. Close any page-detail overlay first — it covers the graph. | Brain section |
| `app-models.png` | Models, full stage, **Discover**: Hugging Face results with hardware-fit scoring and size/quant columns. Richer than My models, which reads empty. | Models section |
| `app-research.png` | Research full stage with a finished report open — progress stepper done, sources listed, synthesis text visible. | Research section |
| `app-issues.png` | Issues, **Board** view, several issues across statuses with priorities and labels. The list view with one row reads empty — seed a few first. | Grid, column 1 |
| `app-scheduler.png` | Scheduler **side panel** open over Code with two or three jobs and their next-run times. | Grid, column 2 |
| `themes.png` | Settings → Appearance theme gallery, or a 2×2 montage of the same screen in four themes. Sells the sixteen-theme claim. | Make it yours |

## Capture guidelines

- **2× device pixel ratio**, dark theme, 16:9. Grid shots (`app-issues`, `app-scheduler`) render about a third as wide — crop tighter so they stay legible.
- **One theme across the whole set.** Re-shoot `hero.png` with the rest so the README does not look stitched together.
- **Real data, never empty states.** Issues, Research, and Models → My models all read blank on a fresh profile; seed them or pick a section that has content.
- **Full-stage apps** (Models, Brain, Research, Issues) should fill `#osAppsLayer` before capturing — not a small floating window.
- **Scrub anything personal**: absolute paths with your username in the menubar, real repo and client names, provider keys, chat titles. Use a demo workspace.
- Keep each file under ~600 KB. PNG.

Extra shots for the guides are welcome — reference them from the guide that needs them and add a row above.
