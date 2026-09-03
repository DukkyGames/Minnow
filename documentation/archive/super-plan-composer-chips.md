# Super Plan composer chips, popovers, and Expand

Confirmed shape brief (product). Match Research. Do not invent a third chip or popover language.

## Todos

- [x] Unclip Super Plan chip popovers: `.sp-opts` wraps, `overflow: visible` (no `overflow-x: auto`)
- [x] Paint chip labels from live controls; Interview listens to `input` and `change`
- [x] Update Super Plan config cache before any `await` in `saveSuperPlanConfig`
- [x] Tests: Interview chip updates on first `input`; CSS contract forbids `.sp-opts { overflow-x: auto }`
- [x] Tests: `saveSuperPlanConfig` then `getSuperPlanConfigSync` without awaiting
- [x] Mount Expand (ghost 32px sparkles) immediately before send on Super Plan and Research
- [x] Bind pre-built Expand buttons in place; cancel Super Plan expand on page teardown
- [x] Tests: Super Plan + Research Expand mount, disabled until text, click expands the field
- [x] Docs: `context.md` plus one manual sentence on Super Plan and Research compose screens

## Visual direction

Restrained. Scene: a developer at a desk, Super Plan compose, chips and popovers must match Research so the two apps feel like one product.

North-star mock: skipped. This is a repair of existing Research-matching chrome, not a new surface.

## Anti-goals

No Popover API. No portal. No orange Expand (send stays the only accent). No third chip pattern.
