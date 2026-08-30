import {
  isConstrainedToolCallsAvailable
} from "./capability-probe.js";
import { buildToolCallResponseFormat } from "./tool-call-schema.js";
function applyConstrainedToolCallsToBody(body, input) {
  if (input.enabledTools.length === 0) {
    return { body, usedConstrained: false };
  }
  if (!isConstrainedToolCallsAvailable(
    input.providerId,
    input.modelId,
    input.userEnabled,
    input.capabilities
  )) {
    return { body, usedConstrained: false };
  }
  const responseFormat = buildToolCallResponseFormat(input.enabledTools);
  if (!responseFormat) {
    return { body, usedConstrained: false };
  }
  return {
    body: { ...body, response_format: responseFormat },
    usedConstrained: true
  };
}
function stripResponseFormatFromBody(body) {
  const { response_format: _rf, ...rest } = body;
  return rest;
}
function isResponseFormatRejectionError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (!lower.includes("400") && !lower.includes("422")) {
    return false;
  }
  return lower.includes("response_format") || lower.includes("json_schema") || lower.includes("grammar") || lower.includes("structured output") || lower.includes("structured_output");
}
function logConstrainedDebug(event, detail) {
  void event;
  void detail;
}
export {
  applyConstrainedToolCallsToBody,
  isResponseFormatRejectionError,
  logConstrainedDebug,
  stripResponseFormatFromBody
};
