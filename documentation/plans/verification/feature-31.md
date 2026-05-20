# Verification — Feature 31 (Ask Question cards)

Run `npm run build` and `npm test` (expect **0** failures).

## Manual UI

- [ ] Enable tools; send a turn that triggers `ask_question` (or simulate via devtools by calling `showQuestionCardsModal` with fixture args in console if needed).
- [ ] **One question:** strip appears in `#questionHost` below `#toolApprovalHost`; composer hidden; **Submit answers** visible on the only card; submit returns and loop continues.
- [ ] **Multiple questions:** prev/next and `N / M` indicator; submit only on last card; cannot submit until every card answered.
- [ ] **Other:** selecting Other shows textarea; submit requires non-empty text when Other is selected.
- [ ] **Multi-select** (`allow_multiple: true`): multiple presets allowed; Other remains exclusive with presets.
- [ ] **Esc** / close **×**: tool result `cancelled`; composer returns.
- [ ] **Stop** during strip: strip closes; turn aborts.
- [ ] **Tool result bubble:** expanded **Result** shows numbered `<ol>` lines, not raw JSON.
- [ ] **Plan mode:** `ask_question` appears in tool list when enabled; strip works.
- [ ] **Sub-agent:** optional badge shows when `subAgentType` is set in tool context.

## Regression

- [ ] Tool approval strip still works above question host when both could appear in edge cases.
- [ ] `npm start` seed `tools.json` includes `ask_question` enabled with `full` permission for new homes.
