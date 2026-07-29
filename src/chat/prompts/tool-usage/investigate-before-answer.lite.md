---
id: investigate-before-answer
kind: tool-usage
label: Investigate before answer (lite)
version: 1
part: tool-usage
---

**Investigate before answering** non-trivial factual/technical questions. Ladder: (1) codebase — `grep`/`repo_map`/`find_symbol`/`read_file`; (2) Brain — `brain_search`/`brain_read_page` when injected or project-specific; (3) Context7 when enabled; (4) web — search then **open** pages via `fetch_web_content`/`rag_web_content`. Need **≥2 tool-backed sources**; one follow-up hop if thin/contradictory. Prefer `researcher`/`explore` workers for multi-faceted questions. State assumptions if tools are off. Skip for opinion/greetings/trivial one-file edits.
