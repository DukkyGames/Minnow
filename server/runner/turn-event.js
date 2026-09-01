/**
 * Shared TurnEvent frequency classification (P10-B / MIN-767).
 *
 * The inner loop now emits per-round and mid-stream chrome events so a caller
 * can rebuild live UI without a second SSE parser. Some of those fire many
 * times per second (`stream_meta` is throttled to ~12 Hz). A board attempt
 * transcript that recorded them would burn MAX_LINES in minutes and then
 * drop the tool_call / tool_result lines the transcript exists to keep.
 *
 * One disk predicate lives here — the package that owns the type — so the
 * board recorder cannot drift from transcripts.js. Sub-agent live SSE has a
 * narrower allow-list (`shouldEmitSubAgentLiveTurnEvent`) because `phase` is
 * not 12 Hz and cards need it (P10-L / MIN-777).
 */

/**
 * Event types that must never be written to an attempt transcript.
 *
 * `round_end` is deliberately absent: it fires once per model round and is
 * the per-round accounting a reader wants.
 *
 * P10-L / MIN-777: `phase` stays on this list for **disk** transcripts
 * (it would still burn MAX_LINES if recorded every round). Sub-agent **live**
 * SSE uses {@link shouldEmitSubAgentLiveTurnEvent} so cards can leave the
 * generating fallback before the first tool. Board live SSE still drops the
 * whole set — boards already map phase from tool events on the parent stream.
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function isHighFrequencyTurnEvent(type) {
  switch (type) {
    case 'stream_meta':
    case 'phase':
    case 'round_start':
    case 'reasoning_end':
    case 'token':
    case 'delta':
    case 'reasoning_delta':
      return true;
    default:
      return false;
  }
}

/**
 * Sub-agent live SSE allow-list (P10-L / MIN-777).
 *
 * `phase` changes a handful of times per turn, not at 12 Hz. Forward it so
 * `onLive` can paint thinking/generating/tools before the first `tool_call`.
 * Keep dropping the true flood types (`stream_meta` / `delta` / `token` /
 * `reasoning_delta`) and the once-per-round chrome that cards do not show
 * (`round_start` / `reasoning_end`).
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function shouldEmitSubAgentLiveTurnEvent(type) {
  if (type === 'phase') return true;
  return !isHighFrequencyTurnEvent(type);
}
