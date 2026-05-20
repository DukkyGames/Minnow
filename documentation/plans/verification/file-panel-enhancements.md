# Verification — File panel enhancements

Requires `npm start` (not `npm run dev` alone).

## Phase 1 — Auto tree

- [ ] On load with server up, file sidebar shows project tree without opening Files or clicking refresh
- [ ] Offline shows “Start with npm start…” message
- [ ] Refresh button still reloads expanded dirs

## Phase 2 — Drag to chat

- [ ] Drag file row (move pointer >5px) to composer → workspace chip appears
- [ ] Click row without drag still opens viewer
- [ ] Send message resolves file via read_file (check user bubble `<file>` block)
- [ ] Duplicate drop dedupes chip

## Phase 3 — Syntax highlighting

- [ ] Open `.ts` file — keywords/strings/comments colored (not flat monospace)

## Phase 4 — Edit and save

- [ ] Edit file → path shows ●, Save enabled
- [ ] Ctrl+S persists via save_file; dirty clears
- [ ] Close with unsaved changes prompts
- [ ] File >512KB excerpt is read-only with banner

## Phase 5 — LSP completion

- [ ] With LSP enabled and TS server installed, typing in `.ts` viewer shows completions
- [ ] `npm run test:lsp` passes

## Automated

- [ ] `npm test` passes
- [ ] `npm run build` passes
