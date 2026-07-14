---
id: context7-docs
kind: tool-usage
label: Context7 library docs
version: 1
part: tool-usage
description: Context7 MCP workflow for third-party library and framework documentation.
---

## Context7 library docs

When the task involves a third-party library, framework, or SDK, prefer Context7 over web search for API syntax and configuration.

### Workflow

1. Call **`mcp__context7__resolve-library-id`** with the package or library name to get a library id.
2. Call **`mcp__context7__get-library-docs`** with that id and a **topic** (API surface, migration, config, version-specific behavior).

### When to use web instead

Use `web_search` / `fetch_web_content` / `rag_web_content` for release news, GitHub issues, repo-specific discussions, or facts Context7 does not cover.

Requires Context7 enabled in **Settings → MCP** (API key optional; improves rate limits).
