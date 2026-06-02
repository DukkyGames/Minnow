/** Shared Orchestrate board parse/init kickoff user messages. */

/** First user turn from Board onboarding before the model runs board_init (MIN-5). */
export const BOARD_ONBOARDING_KICKOFF_MESSAGE =
  'Parse the selected plan and call board_init with each task\'s build and test spec and category. Do not start any tasks.';

/** Legacy alias for onboarding kickoff (historical transcripts / init-split detection). */
export const BOARD_BUILD_KICKOFF_MESSAGE = BOARD_ONBOARDING_KICKOFF_MESSAGE;
