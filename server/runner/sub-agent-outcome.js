const SUB_AGENT_MAX_TOOL_TURNS_ERROR = "maximum tool turns reached";
const SUB_AGENT_CONTEXT_BUDGET_ERROR = "context budget exceeded";
function isMaxToolTurnSummary(summary) {
  return /maximum tool turns/i.test(summary);
}
function isMaxToolTurnFailure(summary, error) {
  if (error === SUB_AGENT_MAX_TOOL_TURNS_ERROR) return true;
  return isMaxToolTurnSummary(summary);
}
function isContextBudgetFailure(error) {
  return error === SUB_AGENT_CONTEXT_BUDGET_ERROR;
}
function isSubAgentRunSuccessful(run) {
  if (run.status !== "completed") return false;
  return !isMaxToolTurnFailure(run.summary, run.error);
}
function isSubAgentRunTerminal(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}
export {
  SUB_AGENT_CONTEXT_BUDGET_ERROR,
  SUB_AGENT_MAX_TOOL_TURNS_ERROR,
  isContextBudgetFailure,
  isMaxToolTurnFailure,
  isMaxToolTurnSummary,
  isSubAgentRunSuccessful,
  isSubAgentRunTerminal
};
