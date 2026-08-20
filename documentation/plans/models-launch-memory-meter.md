# Load tab: visual launch memory

## Status

Implemented.

## Why

The Models inspector Load tab already estimates VRAM and RAM for the current
context / GPU-layers / KV settings, then compares them to hardware. That work
was a muted sentence (`Estimated memory at launch: ~18.1 GB VRAM + …`). A
developer dragging context length needs occupancy against this machine, not a
caption they have to parse.

## Direction

Calm instrumentation, not a KPI card.

- Two occupancy rows (VRAM, RAM) with mono values and a 6px track, same family
  as the chat stats token bars.
- Fill is muted ink when the launch fits; warning / danger only as occupancy
  semantics (never navigation chrome).
- Color is never the only signal: the value string names used / budget, and a
  caption states tight or over.
- No nested card, side stripe, hero number, or fake percentage when hardware is
  unknown.

## Todos

- [x] Pure view-model: rows, tones, captions, static labels
- [x] Replace the Load-tab hint paragraph with the meter
- [x] Inspector CSS (`--mn-*` tokens, reduced-motion no-ops)
- [x] Tests for tones, hidden RAM floor, CPU-only, and DOM on the Load tab
- [x] Note the widget in `documentation/context.md`

## Anti-goals

- Giant “18.1 GB” hero metric
- Decorative gauge chrome
- Animating fill from 0 on every slider rebuild (the inspector re-renders the
  whole Load tab on `input`)
