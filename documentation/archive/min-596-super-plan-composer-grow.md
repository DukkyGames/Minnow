# MIN-596 — Super Plan composer grows with input lines

## Problem

The Super Plan compose textarea (`.sp-composer__field`) is a fixed-height box (`rows="4"`, `min-height: 96px`, `max-height: 320px`, `resize: none`). Extra lines scroll inside the box instead of growing the field the way the Code / Chat composers do.

## Approach

Reuse the chat composer path, not a Super Plan-only height hack:

1. CSS `field-sizing: content` so Electron 43+ grows in the compositor (no per-keystroke `height: auto`).
2. JS `autoResize` fallback when `field-sizing` is unsupported, wired through `bindComposerAutoResize` in [`composer-auto-resize.ts`](../src/ui/composer-auto-resize.ts) so Super Plan does not import the Code send graph.
3. Keep Super Plan’s taller floor (`96px`) and cap (`min(40vh, 320px)`). `autoResize` reads computed min/max height so the fallback does not collapse the field to the chat 44px floor.

## Todos

- [x] Add `field-sizing: content` (plus overflow / scrollbar / ligature parity) to `.sp-composer__field`
- [x] Extract `bindComposerAutoResize` and respect CSS min/max in `autoResize`
- [x] Wire Super Plan compose + seed chips to auto-resize
- [x] Tests: CSS contract, fallback height, CSS min-height floor
- [x] Note the Super Plan composer in `documentation/context.md`

## Verification

- `node --test --import ./test/test-loader.mjs --import tsx test/ui/composer-auto-resize.test.mjs test/ui/super-plan-page.test.mts`
- `npx tsc --noEmit`
