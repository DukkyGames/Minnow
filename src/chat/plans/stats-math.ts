/**
 * Re-export of the shared runner package (MIN-698).
 *
 * Token/speed rollup for chat metrics and evals — not a board engine. The
 * runner already owns the implementation; this file exists so the renderer
 * does not import `src/chat/orchestrate/` for math (MIN-714).
 */
export * from '../../../server/runner/stats-math.js';
