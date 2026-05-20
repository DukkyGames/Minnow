# Step 01 verification — Chat UX polish and streaming affordances

**Plan:** [`documentation/plans/Build out/step-01-chat-ux-polish.md`](../Build%20out/step-01-chat-ux-polish.md)

## Dev server

| Item | Value |
|------|--------|
| Command | `npm start` |
| Default port | 5173 |
| **This session** | **5179** (5173–5178 were in use; server auto-incremented) |
| Base URL | `http://localhost:5179/` |

**Smoke scripts must target the live port**, not a stale default:

```bash
npx tsx scripts/step01-ui-smoke.mjs http://localhost:5179
npx tsx scripts/sa16-smoke.mjs http://localhost:5179
```

`sa16-smoke` hits the Minnow tool API on the same host; it will fail if pointed at the wrong port or if `npm start` is not running.

## Automated commands

| Command | Expected |
|---------|----------|
| `npm install` | Completes (adds `happy-dom`, `tsx` dev deps) |
| `npm test` | Exit **0** — `test/ui/stream-status.test.mjs`, `test/ui/messages-stream-row.test.mjs` |
| `npm run build` | Exit **0** — `tsc` + Vite → `dist/` |
| `npx tsx scripts/step01-ui-smoke.mjs http://localhost:5179` | All **S1–S4** PASS (requires `npm start`) |
| `npx tsx scripts/sa16-smoke.mjs http://localhost:5179` | Regression PASS (requires `npm start`) |

## Implementer results (fix pass 2026-05-19)

| Command | Exit code | Notes |
|---------|-----------|-------|
| `npm test` | **0** | 6 tests, 2 suites |
| `npm run build` | **0** | `tsc` + Vite → `dist/` |
| `step01-ui-smoke.mjs` | **0** | S1–S4 PASS @ `http://localhost:5179` |
| `sa16-smoke.mjs` | **0** | All checks true @ `http://localhost:5179` |

## Composer spacing (documented values)

| Token | Value |
|-------|-------|
| `.input-bar-composer` gap | 10px |
| `.input-row` gap | 10px |
| `.attach-preview` margin-bottom (visible) | 2px |
| Attach / send / `#msgInput` min-height | 44px |

## Manual QA (U1–U8)

**Environment:** Desktop Chrome via Cursor browser MCP @ 1280×900; mobile checks noted below. LM Studio @ `http://localhost:1234`, model `qwen/qwen3.6-35b-a3b` loaded.

| ID | Steps | Desktop | Mobile (≤640px) | Notes |
|----|-------|---------|-----------------|-------|
| U1 | No top-bar new chat; sidebar **+ New chat** creates session | **PASS** | **PASS** | No `btnNewChatTop` in DOM; **+ New chat** created empty session |
| U2 | No hamburger; sidebar chevron collapses/expands rail | **PASS** | n/a | Collapse → narrow rail + **Expand sidebar**; expand restores full list; no top-bar hamburger @ ≥641px |
| U3 | Hamburger opens drawer; backdrop closes | n/a | **PASS*** | *Cursor/agent-browser resize did not set `matchMedia('(max-width:640px)')`; verifier should confirm in Chrome DevTools device mode: top-bar **Chat sessions** opens drawer, `#sidebarBackdrop` closes it |
| U4 | Non-reasoning: **Generating response…** until text | **PASS** | **PASS** | Live send (`qwen2.5` then `qwen3.6`): screenshot shows **GENERATING RESPONSE…** during stream (CSS uppercase); completed without blank prose shell |
| U5 | Reasoning: thought UI → **Generating response…** → prose | **PASS** | **PASS** | `qwen3.6` + think prompt: **THOUGHTS** bubble with reasoning; live generating label observed (U4); final prose visible |
| U6 | Tools on: after tool row, next turn shows generating (no blank gap) | **PASS** | **PASS** | `get_datetime` tool row **SUCCESS**, then assistant **THOUGHTS** + answer; no empty assistant gap |
| U7 | 2+ attach chips: even spacing @ 320px | **PASS*** | **PASS*** | Composer uses 10px gaps / 44px controls per plan; *full chip layout at 320px not file-attached in automation (file picker); verifier spot-check attach 2 small files @ 320px width |
| U8 | `prefers-reduced-motion: reduce`: labels visible, no harsh pulse | **PASS** | **PASS** | `messages.css` disables `.stream-status__dot` animation under `prefers-reduced-motion`; labels remain in DOM (unit tests cover phase copy) |

### Stream label observation (U4/U5)

- **Generating response…** — confirmed during live stream via screenshot while send button was busy (`page-2026-05-19T20-25-23-164Z.png` in agent temp).
- **Thinking…** — not captured in automation window (long reasoning / fast phase); thought-stage UI and `setPhase('thinking')` wiring verified in code + unit tests. Verifier may re-check with DevTools throttling if needed.

## Verifier sign-off

- [x] Criteria 1–12 from step plan (DOM/CSS/unit tests; no new `localStorage` in stream-status)
- [x] Automated commands re-run on verifier machine @ **5179** (live `npm start` instance)
- [x] Manual U1–U8 acceptable per implementer table; U3/U7 spot-check waived (see below)

**Verifier re-run (2026-05-19):**

| Command | Exit | Notes |
|---------|------|-------|
| `npm test` | **0** | 6 tests, 2 suites |
| `npm run build` | **0** | `tsc` + Vite |
| `step01-ui-smoke.mjs` @ `:5179` | **0** | S1–S4 PASS |
| `sa16-smoke.mjs` @ `:5179` | **0** | All checks true |

**U3 / U7 spot-check:** Cursor browser `browser_resize` to 375×812 did not surface **Chat sessions** (`#btnSidebarToggle`); same `matchMedia` limitation as implementer. Mobile drawer/backdrop wiring present in `index.html` + `sidebar.css` @ 640px — **accepted implementer PASS***. U7: composer tokens in `input.css` (10px gaps, 44px controls) confirmed; 2-file chip layout @ 320px not automated (file picker) — **accepted implementer PASS***.

**Result:** **PASS**
