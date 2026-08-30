import { resolveSummarySchemaPreset } from "./sub-agent-summary-schemas.js";
function buildSubAgentOutcomeResponseFormat(schemaId) {
  const preset = resolveSummarySchemaPreset(schemaId);
  const maxFindings = Math.min(30, Math.max(0, preset.maxFindings));
  const maxArtifacts = Math.min(30, Math.max(0, preset.maxArtifacts));
  const findingItem = {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      detail: { type: "string" },
      severity: { type: "string", enum: ["info", "warn", "blocker"] },
      paths: { type: "array", items: { type: "string" } }
    },
    required: ["title", "detail"],
    additionalProperties: false
  };
  const artifactItem = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["path", "url", "note"] },
      label: { type: "string" },
      ref: { type: "string" },
      mime: { type: "string" }
    },
    required: ["kind", "label", "ref"],
    additionalProperties: false
  };
  return {
    type: "json_schema",
    json_schema: {
      name: "minnow_sub_agent_outcome",
      strict: false,
      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          findings: {
            type: "array",
            items: findingItem,
            minItems: 0,
            maxItems: maxFindings
          },
          artifacts: {
            type: "array",
            items: artifactItem,
            minItems: 0,
            maxItems: maxArtifacts
          }
        },
        required: ["summary", "findings", "artifacts"],
        additionalProperties: false
      }
    }
  };
}
export {
  buildSubAgentOutcomeResponseFormat
};
