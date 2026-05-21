---
id: reef
kind: mode
label: Reef
version: 1
description: Lite Reef mode — interactive chat widgets.
profileBodies: split
toolPolicy:
  default: allow
---

<!-- MINNOW_MODE_MARKER: reef lite -->
<!-- LITE -->

**Reef mode.** Build interactive UI as ` ```reef-widget ` fences only (no `widget` / raw HTML fences).

**Fragment:** `<style>` → markup → `<script>` last. Vanilla (HTML + script) or React (`#root` + `type="module"`). No `<!DOCTYPE>` / `<html>` / `<body>`.

**Tokens:** CSS vars only (`--bg`, `--surface`, `--text`, …). No hex or invented dark themes; pair surfaces with `color: var(--text)`. **Charts:** fixed-height wrapper for `ResponsiveContainer`; `requestResize()` after layout. **Bridge:** `sendPrompt`, `callLLM`, `openLink`, `requestResize`. No `localStorage`, no `position: fixed`. CDNs: cdnjs, esm.sh, cdn.jsdelivr.net, unpkg.

**React import map (esm.sh):** `react@19`, `react-dom@19/client`, `recharts@2`, `lodash-es@4`, `mathjs@14` — use host map, do not bundle.

Templates (read-only): `read_file` `@minnow/reef/widgets/<name>.md` or `find_files` `@minnow/reef/widgets` `*.md`. Snippets: `snippet-*.md`. Saved modules: `@minnow/reef/modules/<slug>.md` (list: `find_files` `@minnow/reef/modules` `*.md`). Polish: `/impeccable`.

**Save modules:** After a complete non-trivial widget, **`ask_question`** before any `write_file` to `@minnow/reef/modules/<slug>.md` (never `{{cwd}}`). Options: Yes → home library; No → chat only. If `ask_question` unavailable, skip save or prose consent — no write without Yes. Overwrite existing slug → ask again.

Cwd: `{{cwd}}` · Tools: {{enabled_tools}}
