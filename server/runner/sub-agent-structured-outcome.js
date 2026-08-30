import {
  DEFAULT_SUB_AGENT_SUMMARY_SCHEMA,
  resolveSummarySchemaPreset,
  validateStructuredOutcomeForPreset
} from "./sub-agent-summary-schemas.js";
const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;
function extractJsonTextFromAssistantBody(text) {
  const trimmed = text.trim();
  const fence = trimmed.match(JSON_FENCE_RE);
  if (fence?.[1]) return fence[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
function parseStructuredOutcomeJson(text) {
  const jsonText = extractJsonTextFromAssistantBody(text);
  return JSON.parse(jsonText);
}
function validateStructuredOutcome(raw, schemaId) {
  const preset = resolveSummarySchemaPreset(schemaId);
  return validateStructuredOutcomeForPreset(raw, preset);
}
function legacyOutcomeFromSummary(summary) {
  const text = summary.trim() || "Sub-agent completed with no text output.";
  return { summary: text, findings: [], artifacts: [] };
}
function tryParseStructuredOutcomeFromAssistantProse(text, schemaId) {
  const trimmed = text.trim();
  if (!trimmed || !trimmed.includes("{") || !trimmed.includes("summary")) {
    return null;
  }
  try {
    const parsed = parseStructuredOutcomeJson(trimmed);
    return validateStructuredOutcome(parsed, schemaId);
  } catch {
    return null;
  }
}
function buildSubAgentFinalizationPrompt(schemaId) {
  const preset = resolveSummarySchemaPreset(schemaId);
  const findingsRule = preset.maxFindings === 0 ? "Return an empty findings array." : `Include up to ${preset.maxFindings} findings with title and detail strings.`;
  return `

---

## Final response (required)

Your task is complete. Respond with **only** valid JSON (no markdown outside a json code fence) matching schema "${preset.id}":
{
  "summary": "1-3 sentences for the parent agent",
  "findings": [{ "title": "...", "detail": "...", "severity": "info|warn|blocker", "paths": ["optional/path"] }],
  "artifacts": [{ "kind": "path|url|note", "label": "...", "ref": "..." }]
}

Rules:
- ${findingsRule}
- Artifacts are references only (paths, URLs, notes) \u2014 never embed large file bodies.
- Do not call tools in this message.`;
}
const SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT = "Your previous message was not valid JSON for the required outcome schema. Reply with ONLY valid JSON matching the schema (summary, findings, artifacts). No prose.";
export {
  DEFAULT_SUB_AGENT_SUMMARY_SCHEMA,
  SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT,
  buildSubAgentFinalizationPrompt,
  extractJsonTextFromAssistantBody,
  legacyOutcomeFromSummary,
  parseStructuredOutcomeJson,
  tryParseStructuredOutcomeFromAssistantProse,
  validateStructuredOutcome
};
