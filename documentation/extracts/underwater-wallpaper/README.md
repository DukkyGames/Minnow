# Minnow Underwater Wallpaper — Extract

Portable copy of the Minnow **Underwater** desktop wallpaper (default wallpaper in Minnow). Pure DOM + CSS — no images, no canvas, no build step.

## What it is

An animated ambient background with:

- Layered gradient depth (theme-tinted)
- Soft accent glow
- Two drifting caustic light layers
- Rising bubbles (16, randomized once at load)
- Edge vignette

## Files

| File | Purpose |
|------|---------|
| `underwater-wallpaper.css` | All styles + default `swamp-dark` color tokens |
| `underwater-wallpaper.js` | `renderUnderwaterWallpaper(container)` mount helper |
| `demo.html` | Standalone preview — open in a browser |

## Quick start

```html
<link rel="stylesheet" href="underwater-wallpaper.css" />
<div id="wall" style="position:fixed;inset:0;"></div>
<script type="module">
  import { renderUnderwaterWallpaper } from './underwater-wallpaper.js';
  renderUnderwaterWallpaper(document.getElementById('wall'));
</script>
```

Or open `demo.html` directly.

## Theming

Override CSS variables on `:root` or a wrapper:

```css
:root {
  --os-bg: #0f1216;
  --os-wall-a: #0c100e;
  --os-wall-b: #0a0d0c;
  --os-wall-c: #11201a;
  --os-accent: #9ec5a7;
  --os-accent-2: #cfe5d4;
  --os-accent-soft: rgba(158, 197, 167, 0.14);
}
```

Theme-specific wallpaper tints from Minnow live in `src/styles/minnowos-tokens.css` (`--os-wall-a/b/c` per `data-theme`).

## API

```js
renderUnderwaterWallpaper(container: HTMLElement): void
```

Replaces `container` children with the wallpaper DOM. Container should fill its parent (`position: absolute; inset: 0` or `position: fixed; inset: 0`).

## Source in Minnow

| Path | Role |
|------|------|
| `src/os/wallpaper.ts` | `renderWallpaper()` — underwater branch (lines ~135–157) |
| `src/styles/minnowos-wallpaper.css` | Caustics, bubbles, vignette, gradient |
| `src/styles/minnowos-tokens.css` | OS token aliases + per-theme wall tints |

## Related (not included)

- **Minnow** wallpaper mode (`minnow`) is a separate canvas boids animation using `/logos/minnow-glyph-white.svg` — see `src/os/wallpaper/minnow-fish.ts`.

## Accessibility

Respects `prefers-reduced-motion: reduce` — caustic drift and bubbles are disabled/hidden.
