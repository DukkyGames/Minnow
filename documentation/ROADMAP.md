# Minnow roadmap

Minnow develops as one local-first development workspace: plan, build, run agents, and keep knowledge without a cloud account. Depth in the build loop comes before breadth across surfaces. This page describes product direction, not delivery dates. Individual engineering work is tracked in Linear and versioned plans under `documentation/plans/`.

This is the one page that talks about work not yet shipped. The manual describes only what is in the build you installed.

## Shipped

- **Code workspace** — chat beside the repo, CodeMirror, LSP, terminal, source control, browser preview, and agent undo.
- **Planning and delivery** — Plan, Super Plan, Orchestrate boards, work agents, isolated worktrees, and test/fix loops.
- **Knowledge and research** — Brain, official Minnow wiki, chat retrieval, code index, saved research, and web RAG.
- **Operations** — Models, providers, routing, Scheduler, Issues, settings, diagnostics, skills, MCP, and local tool plugins.
- **Local-first foundations** — encrypted secrets, on-disk state, optional LAN companion access, and Electron packaging.

## Active direction

| Area | Direction |
|---|---|
| Build loop | Make plan-to-board-to-tested-change reliable across local and cloud models. |
| Documentation | Keep the in-app and GitHub wikis generated from the versioned documentation source. |
| Model runtime | Improve local model setup, routing, constrained tool use, and hardware-aware recommendations. |
| Extensibility | Deepen skills, prompt packs, native tools, MCP, themes, and agent packs without closed services. |
| Accessibility | Maintain keyboard coverage, reduced motion, readable themes, and WCAG 2.1 AA contrast. |

## Behind the release gate

Compare, Benchmarking, and Experts remain in the codebase with tests but do not appear on the shipped app rail. They move to released only when their workflows, reliability, accessibility, documentation, and support burden meet the same bar as the core apps.

See [Apps overview](manual/apps/overview.md) for what users see today.

## How priorities are chosen

1. Reliability and data safety in shipped workflows.
2. Depth in the workspace build loop.
3. Local-first operation and model compatibility.
4. Accessibility and documentation.
5. New surfaces only after existing ones are complete.

Feature requests and bug reports belong in the [GitHub issue tracker](https://github.com/HenriGrimm/Minnow/issues). Roadmap entries describe direction and do not promise a release date.
