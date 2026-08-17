/**
 * @deprecated Launch defaults now come from `planLlamaLaunch` (`PREFERRED_CONTEXT_TOKENS` = 32768
 * in `src/models/launch-plan.mjs`). Kept at 125000 so existing presets stay unchanged —
 * do not rename and do not change the value. Keep in sync with `src/models/default-context-tokens.ts`.
 */
export const DEFAULT_CONTEXT_TOKENS = 125_000;
