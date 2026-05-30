# Feature 05 — Interrupt and steer — verification

Manual QA checklist for MIN-41 / audit item **#5**.

## Prerequisites

- `npm start` with a loaded local model (or mock provider).
- Active chat with a tool-heavy prompt (e.g. “list files in src then read package.json”).

## Functional

1. **Steer during tools** — While tools run, type a correction (e.g. “only read, do not write”) and press Enter or Send. Status shows steering queued; after the current tool finishes, a user row with **Steered** chip appears and the next model round follows the correction.
2. **Steer during prose** — While the assistant streams text, steer with new text. Current tokens finish; steer row appears; model continues with correction in context.
3. **Last write wins** — Steer twice quickly with different text. Only the latest correction is in `pendingSteerMessage` and in the consumed history row.
4. **Stop clears queue** — Queue a steer, then click Stop with an empty composer. No steer row after stop; `pendingSteerMessage` cleared.
5. **Stop vs steer button** — With streaming active: empty composer + primary button → stop; non-empty composer + primary button → steer (no abort).
6. **Switch chat** — Start stream, switch away, steer is not available from composer (background block). Switch back, steer works on active streaming chat.
7. **Reload with pending** — Mid-turn reload with `pendingSteerMessage` and `currentGenerationId` in session; resume consumes steer on next loop iteration.

## Regression

- Stop generation still aborts SSE and shows “Generation stopped” chip.
- Background stream hint unchanged when another chat streams.
- `sendMessageWithTools` when idle still starts a normal turn.

## Automated

```bash
npx tsx --import ./test/test-loader.mjs --test test/chat/steer-message.test.mts test/chat/steer-loop-boundary.test.mts
node --test test/ui/composer-steer.test.mjs
```
