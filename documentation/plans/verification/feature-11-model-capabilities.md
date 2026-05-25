# Feature 11 — Model capability detection (verification)

Plan: [`../Build out/feature-11-model-capability-detection.md`](../Build%20out/feature-11-model-capability-detection.md)

## Automated

```bash
node --test test/providers/capabilities-store.test.js test/providers/capabilities-routes.test.js test/providers/capability-probe.test.js
npx tsx --import ./test/test-loader.mjs --test test/providers/model-capabilities.test.mts test/ui/model-capability-badges.test.mts test/ui/model-select-picker.test.mts
npx tsc --noEmit
```

## Manual QA (`npm start`)

1. LM Studio with one LLM + one VLM → **Refresh models** → confirm `~/.minnow/providers/<id>/capabilities.json` exists.
2. Model picker shows **Vision** badge on VLM; **Tools** / context badges when probe succeeds.
3. Add OpenAI-compatible remote → **Refresh** → badges reflect probe (or `?` in tooltip when unknown).
4. Attach image with non-vision model → send path does not use multimodal API (existing string fallback).
5. Double-click **Refresh** quickly → no duplicate errors; second probe aborts/replaces first.
