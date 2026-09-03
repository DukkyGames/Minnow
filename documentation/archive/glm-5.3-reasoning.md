# GLM-5.3 / GLM-5.3-Flash reasoning support

Z.ai GLM-5.3 and GLM-5.3-Flash always think. `thinking.type: disabled` and `reasoning_effort` values `off`, `medium`, `none`, and `xhigh` return HTTP 400. Minnow now treats the 5.3 family like Qwen3.8: detect by model id, force the real option set, and remap invalid off/medium at send time.

Official docs: [GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3.md), [GLM-5.3-Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash.md).

**Out of scope:** GLM-5.2 still allows disable. Sampler recommendations, `tool_stream`, `thinking.clear_thinking`, and Flash VLM image/video.

## Todos

- [x] Add `isGlm53ModelId`, first-class `max` effort, `GLM53_REASONING_OPTIONS`, ingest aliases, and `ensureGlm53ReasoningAllowedOptions`; wire into catalog / infer / `resolveSendCapabilities`
- [x] Map off/medium to legal GLM-5.3 wire fields in `thinking-to-body` + dual sanitize; never send `thinking.disabled`
- [x] Always-on composer/board: Low/High/Max, hide brain Off, clear invalid stored off/medium; pass `modelId` into title thinking patch
- [x] Tests for detect/infer/send/sanitize/composer; this plan and `documentation/context.md`

## Implementation notes

- Detection: `/(?:^|[^a-z0-9])glm[-_.]?5[._-]?3(?:[^0-9]|$)/i` — `glm-5.3`, `glm-5.3-flash`, `z-ai/glm-5.3-flash`, `GLM-5.3-Flash-GGUF`. Not GLM-4.x / 5 / 5.1 / 5.2.
- Forced options: `['low', 'high', 'max']`, default **max**. Catalog off/on or low/medium/high rows are replaced, not merged.
- Ingest: `xhigh` / `extra_high` → `max` only for GLM-5.3; Qwen `xhigh` still maps to High.
- Send: always `thinking: { type: 'enabled' }`. Off / utility thinking-off / medium → wire `low`. Composer High → `high`; Max → `max`. Skip `enable_thinking: false`.
- Sanitize (client + server) rewrites `disabled` and illegal `reasoning_effort` as a last-line defense.
- Composer: no Off brain; leftover Off/Medium from a previous model is cleared so the dropdown shows Max.
- Utility callers (prompt expander, titles, git commit, editor AI) keep calling thinking-off; the shared mapper already emits enabled + low when `modelId` is GLM-5.3.
