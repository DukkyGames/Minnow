/**
 * Lightweight epoch counters for outbound prompt token estimate memoization.
 * Bumped when tool or prompt configuration changes — never use deep equality on config blobs.
 */

let toolConfigEpoch = 0;
let promptConfigEpoch = 0;

export function getToolConfigEpoch(): number {
  return toolConfigEpoch;
}

export function getPromptConfigEpoch(): number {
  return promptConfigEpoch;
}

/** Call after tool enablement, MCP, or related settings are persisted. */
export function bumpToolConfigEpoch(): void {
  toolConfigEpoch += 1;
}

/** Call after system prompt overrides, prompt profiles, or user rules are persisted. */
export function bumpPromptConfigEpoch(): void {
  promptConfigEpoch += 1;
}

/** Reset epochs between unit tests. */
export function resetOutboundEstimateEpochsForTests(): void {
  toolConfigEpoch = 0;
  promptConfigEpoch = 0;
}
