const INJECTION_BODY_MAX_CHARS = 24e3;
function injectionNoticeLabel(kind) {
  switch (kind) {
    case "brain-notes":
      return "Brain notes injected\u2026";
    case "code-map":
      return "Code map injected\u2026";
    case "context-documents":
      return "Context documents injected\u2026";
    default:
      return "Context injected\u2026";
  }
}
function injectionNoticeAction(kind) {
  switch (kind) {
    case "brain-notes":
      return "Brain notes";
    case "code-map":
      return "Code map";
    case "context-documents":
      return "Context documents";
    default:
      return "Context";
  }
}
function injectionNoticeOutcome(body) {
  const trimmed = body?.trim();
  if (!trimmed) return "Injected";
  const lines = trimmed.split("\n").length;
  return lines === 1 ? "1 line" : `${lines} lines`;
}
function isUiOnlyTranscriptRole(role) {
  return role === "context" || role === "injection";
}
function isUiOnlyTranscriptMessage(msg) {
  return isUiOnlyTranscriptRole(msg.role);
}
function isInjectionNoticeMessage(msg) {
  return msg.role === "injection";
}
function boundInjectionBody(raw) {
  const trimmed = raw.trim();
  if (trimmed.length <= INJECTION_BODY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, INJECTION_BODY_MAX_CHARS)}

[\u2026 truncated for transcript storage]`;
}
function shouldAppendInjection(chat, kind, body) {
  const last = chat.history[chat.history.length - 1];
  if (last && last.role === "injection" && last.kind === kind && last.body === body) {
    return false;
  }
  return true;
}
function rememberInjectedContext(chat, kind, body) {
  if (!chat.injectedContext || typeof chat.injectedContext !== "object") {
    chat.injectedContext = {};
  }
  chat.injectedContext[kind] = body;
}
function appendInjectionNoticesForTurn(chat, blocks) {
  const added = [];
  const candidates = [
    { kind: "brain-notes", raw: blocks.brainNotes },
    { kind: "code-map", raw: blocks.codeMap },
    { kind: "context-documents", raw: blocks.contextDocuments }
  ];
  for (const { kind, raw } of candidates) {
    if (!raw?.trim()) continue;
    const body = boundInjectionBody(raw);
    rememberInjectedContext(chat, kind, body);
    if (!shouldAppendInjection(chat, kind, body)) continue;
    const notice = {
      role: "injection",
      kind,
      body,
      createdAt: Date.now()
    };
    chat.history.push(notice);
    added.push(notice);
  }
  return added;
}
export {
  appendInjectionNoticesForTurn,
  injectionNoticeAction,
  injectionNoticeLabel,
  injectionNoticeOutcome,
  isInjectionNoticeMessage,
  isUiOnlyTranscriptMessage,
  isUiOnlyTranscriptRole
};
