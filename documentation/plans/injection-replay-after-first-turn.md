# Keep Brain notes and code map after the first turn

**Status:** Implemented

After the first user message, the context ring shrinks because follow-up turns **drop** stored Brain notes and the code map. First-turn retrieve already budgeted those bodies. Replay then applied a second cap (20% of the model window) and skipped whole kinds that did not fit. Default context documents (~48k chars) fill that share on a ~68k window, so notes and the map vanish on turn 2+.

The context-usage estimate had the same hole: it composes without `firstUserSend`, so after a user row exists it uses replay. A static cache keyed only on chat/model/epochs could also stick to a first-turn or empty snapshot. Brain notes were folded into System with no breakdown row.

## Todos

- [x] Replay stored injection bodies on later turns without a second window-share cap
- [x] Bust the outbound estimate cache when first-turn → replay or stored bodies change
- [x] Split Brain notes out of the System breakdown row (same as Code map)
- [x] Tests for uncapped replay, compose after turn 1, and the Brain notes row
- [x] Update `documentation/context.md`
- [x] Replay stored bodies unless the source toggle is off (do not re-run live Brain/memory gates)
- [x] Persist `chat.injectedContext` so replay survives missing history rows
- [x] Keep `chat.injectedContext` **untruncated** and prefer it over a capped transcript row

## Correct behavior

- **Fetch** Brain notes / code map / context documents on the first user send only.
- **Replay** the stored `role: 'injection'` bodies on every later turn while that source stays on.
- Per-source first-turn budgets still apply (code-map token budget, memory inject cap, documents `maxTotalChars`). Transcript storage still truncates **notice bodies** at 24k chars, but that copy is display-only: the untruncated block lives in `chat.injectedContext` and is what replay sends.
- Window pressure stays on history trim / compression, not on silently dropping the map.

## Follow-up: replay was still shrinking (2026-09-04)

Turn 2 came in ~5k tokens under turn 1 on a chat with a 407-line code map. `appendInjectionNoticesForTurn`
stored the **bounded** body in both the transcript row and `chat.injectedContext`, so replay resent a
40k-char map cut to 24k. Fixed by splitting the two: bounded body for the transcript row (plus
`truncated: true`), full body in the snapshot, and `resolveInjectionReplay` preferring the snapshot
whenever the newest row for that kind is cut. Chats written before this keep their already-lost text.

## Out of scope

- Re-fetching injections every turn
- Changing last-turn API USED as the ring total
- Raising the 24k transcript **display** cap
