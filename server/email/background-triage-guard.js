/**
 * Pause background email triage while the user is talking to an agent (MIN-444).
 * IMAP sync may continue; LLM triage/variants from the poller are deferred instead.
 */

import { hasActiveUserAgentGenerations } from '../generations/store.js';
import { listActiveRuns } from '../terminal-runner.js';

/** Cooldown after agent activity ends before background triage resumes. */
export const BACKGROUND_TRIAGE_RESUME_BUFFER_MS = 60_000;

let agentTrackingActive = false;
/** @type {number} */
let lastAgentActivityEndedAt = 0;

/**
 * Whether a chat agent turn, sub-agent, or agent shell command is in flight.
 */
export function isAgentConversationActive() {
  if (hasActiveUserAgentGenerations()) {
    return true;
  }
  return listActiveRuns({ source: 'agent' }).length > 0;
}

/**
 * Whether the background poller should skip LLM triage/variant hooks.
 * @param {number} [nowMs]
 * @returns {{ defer: boolean, reason?: 'agent_active' | 'resume_buffer' }}
 */
export function shouldDeferBackgroundEmailTriage(nowMs = Date.now()) {
  const active = isAgentConversationActive();

  if (active) {
    agentTrackingActive = true;
    return { defer: true, reason: 'agent_active' };
  }

  if (agentTrackingActive) {
    lastAgentActivityEndedAt = nowMs;
    agentTrackingActive = false;
  }

  if (
    lastAgentActivityEndedAt > 0 &&
    nowMs - lastAgentActivityEndedAt < BACKGROUND_TRIAGE_RESUME_BUFFER_MS
  ) {
    return { defer: true, reason: 'resume_buffer' };
  }

  return { defer: false };
}

/** Reset guard state (tests). */
export function resetBackgroundTriageGuardForTests() {
  agentTrackingActive = false;
  lastAgentActivityEndedAt = 0;
}
