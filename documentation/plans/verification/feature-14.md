# Feature #14 — Cost / token observability — manual QA

## Prerequisites

- `npm start` (tool server + provider registry)
- Remote OpenAI-compatible provider with `usage` in completions
- Optional: LM Studio local provider without pricing

## Checklist

- [ ] Send a main-chat message; confirm `chat.tokenLedger.totals` increases (devtools / session export)
- [ ] Reload the app; ledger totals persist for the chat
- [ ] Spawn a sub-agent that returns usage; parent chat ledger shows `sub-agent:<type>` in by-source
- [ ] Enable title generation; after first message, ledger includes a `title` row when usage is returned
- [ ] Reef widget `callLLM` with usage metadata adds `reef-widget` source on active chat
- [ ] Settings → **Usage**: active chat totals, session rollup, recent entries table
- [ ] Settings → **Providers** → edit provider → **Model pricing**: save default + per-model JSON; GET `/api/providers` returns `pricing`
- [ ] Priced model shows non-null `costUsd` on ledger entries and Usage panel USD column
- [ ] Local provider with no pricing: tokens recorded, cost displays as $0.00 / —
- [ ] Clear chat history resets ledger for that chat
- [ ] Stats strip **Est. cost** shows last priced turn when available
- [ ] `npm test` — `test/usage/*.test.mjs` and `test/providers/pricing-validate.test.js` pass
