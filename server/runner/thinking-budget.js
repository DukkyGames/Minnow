import { estimateTokensFromText } from "./token-estimate-core.js";
const THINKING_BUDGET_NUDGE_LINE = "I've spent enough time thinking. I'll commit to an answer now.";
const THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION = "Stop extended reasoning. Answer directly in your next reply without further internal deliberation.";
function thinkingBudgetGraceTokens(baseLimitTokens) {
  const base = Math.max(1, Math.round(baseLimitTokens));
  return Math.max(256, Math.round(base * 0.25));
}
class ThinkingBudgetTracker {
  phaseText = "";
  bankedTokens = 0;
  _exceeded = false;
  _nudgeCount = 0;
  _disarmed = false;
  baseLimit;
  limit;
  constructor(limitTokens) {
    this.baseLimit = Math.max(1, Math.round(limitTokens));
    this.limit = this.baseLimit;
  }
  get exceeded() {
    return this._disarmed ? false : this._exceeded;
  }
  /** Configured ceiling, so callers can mirror it into the outbound request body. */
  get limitTokens() {
    return this.limit;
  }
  /** Text of the current contiguous thinking phase — what a continuation carries forward. */
  get sessionText() {
    return this.phaseText;
  }
  get nudgeCount() {
    return this._nudgeCount;
  }
  /** Estimated reasoning tokens spent so far this turn (banked phases + current phase). */
  get spentTokens() {
    return this.bankedTokens + estimateTokensFromText(this.phaseText);
  }
  /** Feed a reasoning delta; marks exceeded when the turn total crosses the limit. */
  feed(delta) {
    if (!delta || this._exceeded) return;
    if (this.phaseText && delta.startsWith(this.phaseText)) {
      this.phaseText = delta;
    } else {
      this.phaseText += delta;
    }
    if (!this._disarmed && this.spentTokens >= this.limit) {
      this._exceeded = true;
      this._nudgeCount += 1;
    }
  }
  /** Bank the current phase and start the next one — the turn total is kept. */
  endSession() {
    this.bankPhase();
    this._exceeded = false;
  }
  /**
   * Enter a budget continuation: bank the phase, clear the trip, and raise the ceiling by
   * a small grace so the continuation can wrap up its reasoning before tripping again.
   */
  beginContinuation(graceTokens) {
    this.bankPhase();
    this._exceeded = false;
    const grace = graceTokens ?? thinkingBudgetGraceTokens(this.baseLimit);
    this.limit += Math.max(0, Math.round(grace));
  }
  /** Permanently stop tripping for the rest of this turn (escalation already ran). */
  disarm() {
    this._disarmed = true;
    this._exceeded = false;
  }
  bankPhase() {
    this.bankedTokens += estimateTokensFromText(this.phaseText);
    this.phaseText = "";
  }
}
function buildThinkingPrefillAssistantMessage(partialThinking) {
  const partial = partialThinking.trimEnd();
  const inner = partial ? `${partial}

${THINKING_BUDGET_NUDGE_LINE}` : THINKING_BUDGET_NUDGE_LINE;
  return {
    role: "assistant",
    content: `<think>
${inner}
</think>

`
  };
}
function buildBudgetContinuationMessages(opts) {
  const thinking = opts.partialThinking.trim();
  const text = opts.partialText.trim();
  const sections = [];
  if (thinking) {
    sections.push(`Reasoning so far:
${thinking}`);
  }
  if (text) {
    sections.push(`Answer written so far:
${text}`);
  }
  const messages = [];
  if (sections.length > 0) {
    messages.push({ role: "assistant", content: sections.join("\n\n") });
  }
  const carried = sections.length > 0;
  const instruction = carried ? `${THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION} Continue from the work above \u2014 keep its conclusions and pick up exactly where it stopped. Do not repeat it and do not start over.${text ? " Write only the remaining part of the answer." : ""}` : THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION;
  messages.push({ role: "user", content: instruction });
  return messages;
}
function stripPrefillEchoFromDelta(delta, partialThinking) {
  if (!delta) return delta;
  let text = delta;
  const trimmedPartial = partialThinking.trim();
  if (trimmedPartial && text.includes(trimmedPartial.slice(0, Math.min(80, trimmedPartial.length)))) {
    const closeIdx = text.indexOf("</think>");
    if (closeIdx >= 0) {
      text = text.slice(closeIdx + "</think>".length);
      text = text.replace(/^\s*\n+/, "");
    }
  }
  if (text.startsWith("<think>")) {
    const closeIdx = text.indexOf("</think>");
    if (closeIdx >= 0) {
      text = text.slice(closeIdx + "</think>".length);
      text = text.replace(/^\s*\n+/, "");
    }
  }
  return text;
}
const CARRIED_ECHO_MIN_CHARS = 40;
function stripCarriedTextEcho(delta, carriedText) {
  if (!delta || !carriedText) return delta;
  const carried = carriedText.trim();
  if (!carried) return delta;
  const lead = delta.replace(/^\s+/, "");
  if (!lead) return delta;
  if (lead.startsWith(carried)) {
    return lead.slice(carried.length);
  }
  if (lead.length >= CARRIED_ECHO_MIN_CHARS && carried.startsWith(lead)) {
    return "";
  }
  return delta;
}
export {
  THINKING_BUDGET_EPHEMERAL_RETRY_INSTRUCTION,
  THINKING_BUDGET_NUDGE_LINE,
  ThinkingBudgetTracker,
  buildBudgetContinuationMessages,
  buildThinkingPrefillAssistantMessage,
  stripCarriedTextEcho,
  stripPrefillEchoFromDelta,
  thinkingBudgetGraceTokens
};
