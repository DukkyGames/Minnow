---
id: fact-verification
kind: tool-usage
label: Fact verification (lite)
version: 1
part: tool-usage
---

**Verify before plan/build:** Do not rely on training data for library/API facts (same ladder as **Investigate before you answer**). Ladder: (1) codebase — `grep`/`repo_map`/`find_symbol`/`read_file`; (2) Brain wiki if injected or project-specific; (3) Context7 when enabled; (4) web — search then open pages via `fetch_web_content`/`rag_web_content`. Cross-check: repo wins for project state; Context7/web for external APIs. State assumptions if external tools are off.
