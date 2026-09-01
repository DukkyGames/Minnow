/**
 * True for TurnEvent types that must not be recorded on an attempt transcript.
 * `phase` is high-frequency for disk (P10-B) but is forwarded on sub-agent
 * live SSE via {@link shouldEmitSubAgentLiveTurnEvent} (P10-L).
 * `round_end` is not high-frequency — it fires once per model round.
 */
export function isHighFrequencyTurnEvent(type: unknown): boolean;

/**
 * Sub-agent live bus: forward `phase` plus every non-high-frequency type.
 * Do not forward stream_meta / delta / token / reasoning_delta / round_start /
 * reasoning_end.
 */
export function shouldEmitSubAgentLiveTurnEvent(type: unknown): boolean;
