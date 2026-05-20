# Minnow logo assets

## SVG masters (`/svg`)
- `minnow-icon.svg` — primary app icon, 512×512 (black tile, white fish)
- `minnow-icon-light.svg` — light variant (white tile, outline fish)
- `minnow-glyph.svg` — fish only, transparent background
- `minnow-favicon.svg` — simplified geometry for tiny sizes (no eye)
- `minnow-maskable.svg` — Android adaptive icon with safe-zone padding
- `minnow-lockup-horizontal.svg` — icon + wordmark + tagline
- `minnow-lockup-stacked.svg` — icon over wordmark

## PNGs (`/png`)

### Main app icon (use for most things)
`minnow-{16,32,48,64,96,128,180,192,256,384,512,1024}.png`

### Favicon
- `favicon.ico` — multi-resolution (16/32/48), drop into site root
- `minnow-favicon-{16,32,48}.png` — individual sizes if you prefer PNG favicons
- `apple-touch-icon.png` — 180×180 for iOS home-screen

### PWA / Android
- `minnow-192.png` and `minnow-512.png` — standard PWA icons
- `minnow-maskable-{192,512}.png` — maskable icons for Android adaptive

### Variants
- `minnow-light-{128,256,512}.png` — light/outline variant
- `minnow-glyph-{128,256,512}.png` — fish only, transparent bg

### Lockups
- `minnow-lockup-horizontal-{720,1440}.png` — for headers, footers, README
- `minnow-lockup-stacked-{400,800}.png` — for splash, social cards

## Suggested HTML
```html
<link rel="icon" type="image/svg+xml" href="/minnow-favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/minnow-favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/minnow-favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico" sizes="any">
```

## Suggested `manifest.json`
```json
{
  "name": "Minnow",
  "short_name": "Minnow",
  "description": "Tiny by design. Local LLM development tool.",
  "icons": [
    { "src": "/minnow-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/minnow-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/minnow-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/minnow-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

## Colors
- Tile / primary: `#0f0f10`
- Fish / inverse: `#ffffff`
- Tagline grey: `#6b6b70`
