/**
 * Gates for maintainer / QA surfaces that should not ship in default user sessions.
 */

function isTruthyEnv(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '1' || trimmed === 'true' || trimmed === 'yes';
}

/** Orchestrate board-testing API (fake model, seed board, log validation). */
export function isBoardTestingApiEnabled() {
  return isTruthyEnv(process.env.MINNOW_DEBUG) || isTruthyEnv(process.env.MINNOW_TEST);
}
