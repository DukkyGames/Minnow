/**
 * @deprecated Launch defaults now come from `planLlamaLaunch` (`PREFERRED_CONTEXT_TOKENS` = 32768
 * in `src/models/launch-plan.mjs`). Kept at 125000 so Discover ranking stays unchanged —
 * the inspector no longer materializes this as a launch default. Do not rename and do not
 * change the value.
 */
export const DEFAULT_CONTEXT_TOKENS = 125_000;
