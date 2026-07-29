# Chat agent research depth + RAG upgrade

## Goal

Make General / Plan / Build / Debug chat agents (parents and `researcher` / `explore` workers) investigate before answering, and raise Brain / web / archive RAG quality.

## Status

| Todo | Status |
|------|--------|
| Investigate-before-answer prompts + mode wiring | Done |
| Researcher/explore tool allowlists | Done |
| Brain RAG (embeddings on, deeper inject, query excerpts) | Done |
| Web RAG (24KB cap, 16 ranked excerpts) | Done |
| Archive RAG (topK 8 / 12, 800-char excerpts) | Done |
| Docs (`context.md`, this plan) | Done |

## Changes

### Prompt policy

- Added [`src/chat/prompts/tool-usage/investigate-before-answer.md`](../src/chat/prompts/tool-usage/investigate-before-answer.md) (+ lite) — investigation ladder, ≥2 sources, follow-up hop, delegation guidance.
- Wired in [`src/chat/prompts/prompt-composer.ts`](../src/chat/prompts/prompt-composer.ts) for `general`, `desktop`, `plan`, `build`, `debug`.
- General mode no longer prefers training-data answers for non-trivial questions.
- Strengthened [`sub-agent-delegation`](../src/chat/prompts/tool-usage/sub-agent-delegation.md), [`researcher`](../src/agents/prompts/sub-agents/researcher.full.md), and [`explore`](../src/agents/prompts/sub-agents/explore.full.md) worker prompts.

### Worker allowlists

[`src/agents/defaults/sub-agents.json`](../src/agents/defaults/sub-agents.json):

- **researcher:** `brain_search`, `brain_read_page`, `repo_map`, `find_symbol`, `get_file_metadata`, `recall_chat_context`
- **explore:** `rag_web_content`, `brain_search`, `brain_read_page`, `repo_map`, `find_symbol`

### Brain RAG

- `embeddings.enabled: true` by default ([`server/engine/embeddings.js`](../server/engine/embeddings.js), config defaults).
- `maxInjectCharsFull`: 4000 → **8000**; retrieve `limit`: 8 → **12**.
- `formatMemoryBlock` uses `selectQueryRelevantExcerpt` (~500 chars, paragraph/`##` scoring).

### Web RAG

- `WEB_TEXT_MAX_BYTES`: 8192 → **24576**
- `rankWebContentByQuery` — up to **16** sentence + paragraph excerpts
- Updated tool descriptions in [`src/tools/definitions.ts`](../src/tools/definitions.ts)

### Archive RAG

- Default `retrievalTopK`: 5 → **8** ([`src/chat/archive/types.ts`](../src/chat/archive/types.ts))
- Research work-agent archive `retrievalTopK`: 8 → **12**
- Archive hit excerpts: 600 → **800** chars ([`server/brain/retrieve.js`](../server/brain/retrieve.js))

## Out of scope (follow-ups)

- Deep Research IterResearch engine
- Code embeddings (`codeEmbeddingsEnabled`)
- Chunked multi-vector Brain index / ANN
- Global archive LLM rerank

## Test plan

```bash
npm test -- test/prompts/fact-verification-prompt.test.mjs
npm test -- test/memory/retrieve.test.mjs test/memory/memory-api.test.mjs
npm test -- test/tools/fetch-web-content.test.mjs
npm test -- test/sub-agents/sub-agent-config.test.mts
npx tsc --noEmit
```
