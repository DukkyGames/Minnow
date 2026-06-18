# MN-139 Archive policy — manual QA checklist

Verification steps for Brain-backed archive context (MIN-139 deferred completion).

| Scenario | Steps | Pass criteria |
|----------|-------|---------------|
| Long-chat demo | 25+ turn chat, archive policy, wait for bundles | Placeholders appear; prelude on next send; recall tool returns facts |
| Cross-chat leakage | Two chats, same workspace; workspace recall | Chat A facts not returned when `scope: chat` on chat B; workspace scope returns both |
| Embeddings-off gate | Disable Brain embeddings | Archive policy disabled in Settings with tooltip |
| Self-disable | Kill brain server mid-send | Banner shows `getArchiveDisabledReason`; falls back to plain budget |
| Chunking | Single range > bundler token budget | Multiple `turns-*.md` files created |
| Bundler retry | (dev) force bad quotes once | Second attempt succeeds or 422 after two |
| Wiki filter | Open Brain graph | Archive pages hidden by default; **Archives** toggle shows them |
| Researcher preset | New Research chat with work agent auto | `archive` policy + tuned defaults; `recall_chat_context` enabled |
| Entity promotion | Same entity slug in 2+ chats | `workspaces/<key>/concepts/<slug>.md` created |
| Rollup | 3+ turn bundles in one chat | `archive/<chatId>/index.md` rollup page exists |

Sub-agent archive policy remains normalized to **slide** at runtime (intentional).
