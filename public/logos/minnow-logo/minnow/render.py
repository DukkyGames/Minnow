import cairosvg
import os

SVG_DIR = "/home/claude/minnow/svg"
PNG_DIR = "/home/claude/minnow/png"

# (svg filename, output name pattern, list of sizes)
JOBS = [
    # Main app icon — full size ladder
    ("minnow-icon.svg", "minnow-{size}.png", [16, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512, 1024]),
    # Light variant
    ("minnow-icon-light.svg", "minnow-light-{size}.png", [128, 256, 512]),
    # Glyph only (transparent bg)
    ("minnow-glyph.svg", "minnow-glyph-{size}.png", [128, 256, 512]),
    # Favicon-optimized (simplified geometry)
    ("minnow-favicon.svg", "minnow-favicon-{size}.png", [16, 32, 48]),
    # Maskable PWA icon (with safe-zone padding)
    ("minnow-maskable.svg", "minnow-maskable-{size}.png", [192, 512]),
    # Lockups
    ("minnow-lockup-horizontal.svg", "minnow-lockup-horizontal-{size}.png", [720, 1440]),
    ("minnow-lockup-stacked.svg", "minnow-lockup-stacked-{size}.png", [400, 800]),
]

# Special: apple-touch-icon is 180px from main icon
for svg_file, name_pattern, sizes in JOBS:
    svg_path = os.path.join(SVG_DIR, svg_file)
    for size in sizes:
        out_name = name_pattern.format(size=size)
        out_path = os.path.join(PNG_DIR, out_name)
        cairosvg.svg2png(
            url=svg_path,
            write_to=out_path,
            output_width=size,
        )
        print(f"  {out_name}")

# Apple touch icon (semantic name)
cairosvg.svg2png(
    url=os.path.join(SVG_DIR, "minnow-icon.svg"),
    write_to=os.path.join(PNG_DIR, "apple-touch-icon.png"),
    output_width=180,
)
print("  apple-touch-icon.png")

print("\nDone.")
