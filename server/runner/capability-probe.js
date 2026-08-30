const HARMONY_DENY_MODEL_SUBSTRINGS = ["gpt-oss", "harmony"];
const CAPABILITIES_SCHEMA_VERSION = 1;
let capabilitiesCache = /* @__PURE__ */ new Map();
function resetCapabilitiesCache() {
  capabilitiesCache = /* @__PURE__ */ new Map();
}
function setProviderCapabilitiesForTests(providerId, caps) {
  if (caps === null) {
    capabilitiesCache.delete(providerId);
    return;
  }
  capabilitiesCache.set(providerId, caps);
}
function normalizeCapabilities(raw, providerId) {
  if (!raw || typeof raw !== "object") return null;
  const row = raw;
  return {
    schemaVersion: typeof row.schemaVersion === "number" ? row.schemaVersion : CAPABILITIES_SCHEMA_VERSION,
    probedAt: typeof row.probedAt === "string" ? row.probedAt : "",
    providerId: typeof row.providerId === "string" ? row.providerId : providerId,
    structuredOutput: row.structuredOutput === true,
    structuredOutputWithTools: row.structuredOutputWithTools === true,
    structuredOutputStreaming: row.structuredOutputStreaming === true,
    supportsThinkingBudget: row.supportsThinkingBudget === true,
    probeError: typeof row.probeError === "string" ? row.probeError : null,
    models: row.models && typeof row.models === "object" ? row.models : void 0
  };
}
async function readProviderCapabilities(providerId) {
  const cached = capabilitiesCache.get(providerId);
  if (cached) return cached;
  try {
    const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/capabilities`, {
      cache: "no-store"
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const json = await res.json();
    const parsed = normalizeCapabilities(json, providerId);
    if (parsed) capabilitiesCache.set(providerId, parsed);
    return parsed;
  } catch {
    return null;
  }
}
async function probeProviderCapabilities(providerId, options = {}) {
  const res = await fetch(
    `/api/providers/${encodeURIComponent(providerId)}/probe-capabilities`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: options.modelId,
        selectedModelId: options.selectedModelId
      })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    let message = `Probe failed HTTP ${res.status}`;
    try {
      const errJson = JSON.parse(text);
      if (errJson.error) message = errJson.error;
    } catch {
      if (text.trim()) message = text.slice(0, 300);
    }
    throw new Error(message);
  }
  const json = await res.json();
  const parsed = normalizeCapabilities(json, providerId);
  if (!parsed) {
    throw new Error("Invalid capabilities response");
  }
  capabilitiesCache.set(providerId, parsed);
  return parsed;
}
function isHarmonyDeniedModel(modelId) {
  const lower = modelId.trim().toLowerCase();
  if (!lower) return false;
  return HARMONY_DENY_MODEL_SUBSTRINGS.some((part) => lower.includes(part));
}
function structuredOutputBadge(caps, modelId) {
  if (modelId && isHarmonyDeniedModel(modelId)) return "no";
  if (!caps) return "unknown";
  const modelEntry = modelId ? caps.models?.[modelId] : void 0;
  if (modelEntry?.denyReason) return "no";
  if (modelEntry?.structuredOutput === true) return "yes";
  if (modelEntry?.structuredOutput === false) return "no";
  if (caps.structuredOutputWithTools) return "yes";
  if (caps.structuredOutput) return "yes";
  if (caps.probeError) return "no";
  if (caps.probedAt) return "no";
  return "unknown";
}
function isConstrainedToolCallsAvailable(providerId, modelId, userEnabled, capabilities) {
  if (!userEnabled) return false;
  if (isHarmonyDeniedModel(modelId)) return false;
  if (!capabilities) return false;
  if (!capabilities.structuredOutputWithTools && !capabilities.structuredOutput) {
    return false;
  }
  const modelEntry = capabilities.models?.[modelId];
  if (modelEntry?.denyReason) return false;
  if (modelEntry?.structuredOutput === false) return false;
  return capabilities.structuredOutputWithTools === true || capabilities.structuredOutput === true;
}
function isStructuredOutcomeResponseFormatAvailable(modelId, capabilities) {
  if (!modelId.trim()) return false;
  if (isHarmonyDeniedModel(modelId)) return false;
  if (!capabilities) return false;
  const modelEntry = capabilities.models?.[modelId];
  if (modelEntry?.denyReason) return false;
  if (modelEntry?.structuredOutput === true) return true;
  if (modelEntry?.structuredOutput === false) return false;
  if (!capabilities.structuredOutput && !capabilities.structuredOutputWithTools) {
    return false;
  }
  return true;
}
export {
  CAPABILITIES_SCHEMA_VERSION,
  HARMONY_DENY_MODEL_SUBSTRINGS,
  isConstrainedToolCallsAvailable,
  isHarmonyDeniedModel,
  isStructuredOutcomeResponseFormatAvailable,
  probeProviderCapabilities,
  readProviderCapabilities,
  resetCapabilitiesCache,
  setProviderCapabilitiesForTests,
  structuredOutputBadge
};
