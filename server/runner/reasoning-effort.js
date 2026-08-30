const REASONING_EFFORT_OPTIONS = [
  "off",
  "on",
  "low",
  "medium",
  "high"
];
const EFFORT_SET = new Set(REASONING_EFFORT_OPTIONS);
const QWEN38_REASONING_OPTIONS = [
  "off",
  "low",
  "medium",
  "high"
];
function isQwen38ModelId(modelId) {
  if (!modelId) return false;
  return /(?:^|[^a-z0-9])qwen3[._]8(?![0-9])/i.test(modelId);
}
function normalizeReasoningCatalogValue(value) {
  if (value === "xhigh") return "high";
  if (value === "none") return "off";
  return isReasoningEffortOption(value) ? value : void 0;
}
function isReasoningEffortOption(value) {
  return typeof value === "string" && EFFORT_SET.has(value);
}
function normalizeReasoningAllowedOptions(raw) {
  const seen = /* @__PURE__ */ new Set();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const mapped = value === "xhigh" ? "high" : value === "none" ? "off" : value;
    seen.add(mapped);
  }
  return REASONING_EFFORT_OPTIONS.filter((option) => seen.has(option));
}
function modelHasSelectableReasoningEffort(caps) {
  return (caps?.reasoningAllowedOptions?.length ?? 0) >= 2;
}
function modelHasReasoningEffortLevels(caps) {
  const allowed = caps?.reasoningAllowedOptions ?? [];
  return allowed.some((o) => o === "low" || o === "medium" || o === "high");
}
function modelUsesComposerReasoningDropdown(caps) {
  return modelUsesComposerReasoningLevelDropdown(caps);
}
function modelUsesComposerThinkingToggle(caps) {
  if (modelUsesComposerReasoningDropdown(caps)) return false;
  const allowed = caps?.reasoningAllowedOptions ?? [];
  if (allowed.includes("off") && allowed.includes("on")) return true;
  return allowed.length === 0 && caps?.reasoning !== false;
}
function modelShowsComposerBrainToggle(caps) {
  return modelUsesComposerReasoningDropdown(caps) || modelUsesComposerThinkingToggle(caps);
}
function getComposerReasoningLevelOptions(allowed) {
  return allowed.filter((o) => o === "low" || o === "medium" || o === "high");
}
function getComposerReasoningBinaryOptions(allowed) {
  const normalized = normalizeReasoningAllowedOptions(allowed);
  const options = [];
  if (normalized.includes("off")) options.push("off");
  if (normalized.includes("on")) options.push("on");
  return options;
}
function modelUsesComposerReasoningLevelDropdown(caps) {
  return modelHasReasoningEffortLevels(caps);
}
function modelUsesComposerReasoningBinaryDropdown(_caps) {
  return false;
}
function defaultComposerReasoningLevel(caps) {
  const levels = getComposerReasoningLevelOptions(caps?.reasoningAllowedOptions ?? []);
  if (levels.length === 0) return void 0;
  const catalogDefault = caps?.reasoningDefault;
  if (catalogDefault && levels.includes(catalogDefault)) return catalogDefault;
  if (levels.includes("medium")) return "medium";
  return levels[0];
}
function formatReasoningEffortLabel(option) {
  switch (option) {
    case "off":
      return "Off";
    case "on":
      return "On";
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    default:
      return option;
  }
}
function isThinkingTypeOnlyOpenAiModel(modelId) {
  const id = modelId.trim().toLowerCase();
  return /kimi|moonshot|deepseek|minimax/.test(id);
}
function inferReasoningOptionsFromModelId(modelId, apiKind) {
  if (isQwen38ModelId(modelId)) {
    return [...QWEN38_REASONING_OPTIONS];
  }
  if (apiKind !== "openai-v1") return [];
  if (isThinkingTypeOnlyOpenAiModel(modelId)) {
    return ["off", "on"];
  }
  return ["off", "low", "medium", "high"];
}
function ensureQwen38ReasoningAllowedOptions(modelId, allowed) {
  if (!isQwen38ModelId(modelId)) return allowed;
  const hasLevels = allowed.some((o) => o === "low" || o === "medium" || o === "high");
  if (hasLevels) {
    return normalizeReasoningAllowedOptions([...allowed, ...QWEN38_REASONING_OPTIONS]);
  }
  return [...QWEN38_REASONING_OPTIONS];
}
function resolveEffectiveReasoningEffort(chat, caps, inheritedResolved) {
  const allowed = caps?.reasoningAllowedOptions ?? [];
  if (allowed.length === 0) return void 0;
  if (chat.reasoningEffort === "off") {
    return "off";
  }
  if (chat.reasoningEffort && allowed.includes(chat.reasoningEffort)) {
    return chat.reasoningEffort;
  }
  if (inheritedResolved === "on") {
    const catalogDefault2 = caps?.reasoningDefault;
    if (catalogDefault2 && catalogDefault2 !== "off" && allowed.includes(catalogDefault2)) {
      return catalogDefault2;
    }
    if (allowed.includes("medium")) return "medium";
    if (allowed.includes("on")) return "on";
  }
  const catalogDefault = caps?.reasoningDefault;
  if (catalogDefault && allowed.includes(catalogDefault)) {
    return catalogDefault;
  }
  if (inheritedResolved === "off" && allowed.includes("off")) {
    return "off";
  }
  return allowed[0];
}
export {
  QWEN38_REASONING_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  defaultComposerReasoningLevel,
  ensureQwen38ReasoningAllowedOptions,
  formatReasoningEffortLabel,
  getComposerReasoningBinaryOptions,
  getComposerReasoningLevelOptions,
  inferReasoningOptionsFromModelId,
  isQwen38ModelId,
  isReasoningEffortOption,
  modelHasReasoningEffortLevels,
  modelHasSelectableReasoningEffort,
  modelShowsComposerBrainToggle,
  modelUsesComposerReasoningBinaryDropdown,
  modelUsesComposerReasoningDropdown,
  modelUsesComposerReasoningLevelDropdown,
  modelUsesComposerThinkingToggle,
  normalizeReasoningAllowedOptions,
  normalizeReasoningCatalogValue,
  resolveEffectiveReasoningEffort
};
