function classifyStreamEnd(input) {
  const streamError = input.streamError?.trim();
  if (streamError) {
    return { kind: "provider_error", message: streamError };
  }
  if (input.endStatus === "error") {
    return { kind: "provider_error", message: "Generation failed" };
  }
  if (input.endStatus === "cancelled") {
    return { kind: "aborted" };
  }
  if (input.finishReason === "length") {
    return { kind: "truncated" };
  }
  if (input.finishReason || input.toolCallsCount > 0) {
    return { kind: "complete" };
  }
  return { kind: "incomplete" };
}
function applyClassifiedStreamEnd(classified, context) {
  switch (classified.kind) {
    case "provider_error":
      throw new Error(classified.message ?? "Generation failed");
    case "aborted":
      throw new DOMException("Aborted", "AbortError");
    case "truncated":
      return { truncated: true };
    case "incomplete": {
      if (context.textLength === 0 && context.hasPostToolTail) {
        return { truncated: false };
      }
      throw new Error("The model returned no output (the stream ended early).");
    }
    case "complete":
      return { truncated: false };
    default:
      return { truncated: false };
  }
}
export {
  applyClassifiedStreamEnd,
  classifyStreamEnd
};
