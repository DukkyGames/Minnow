# Issues expander (MIN-635)

Thin issues stay thin. Add a prompt-expander-style action that fills them from **the text already on the card**, then lets the user review before anything is saved.

## Todos

- [x] Pure prompt + parser: title-only vs existing details; never invent research
- [x] Utility generation client (prompt-expander model binding, persist: false)
- [x] Review overlay: accept / edit / discard; store unchanged until Apply
- [x] Sparkles action on peek, list menu, board card, command palette, **E**
- [x] Keep triage **Expand with agent** (issue-writer research) as a separate action
- [x] Tests for parser, overlay accept/discard, peek sparkles, command
- [x] Manual + `documentation/context.md`

## Shape

Same sparkles icon as the composer prompt expander. One-shot rewrite, no file search, no `issue_update` from the model.

| Current card | Proposal |
|--------------|----------|
| Title only (no description) | Fuller title **and** a description |
| Title + details | Improved title + details; facts kept |

Peek title and description auto-save on edit, so the proposal cannot stream into those fields. The overlay is the review surface.

Triage **Expand with agent** stays: it still spawns `issue-writer` to research the workspace. The sparkles expander is the quick fill.

## Out of scope

New sub-agent type, new app, changing issue-writer tools, GitHub sync.
