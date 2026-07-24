/**
 * Parse, validate, and repair sub-agent structured final outcomes (MIN-43).
 */

import {
  DEFAULT_SUB_AGENT_SUMMARY_SCHEMA,
  resolveSummarySchemaPreset,
  validateStructuredOutcomeForPreset,
} from './sub-agent-summary-schemas';

/** One structured finding for parent orchestration. */
export interface SubAgentFinding {
  id?: string;
  title: string;
  detail: string;
  severity?: 'info' | 'warn' | 'blocker';
  paths?: string[];
}

/** Reference artifact produced by a sub-agent (refs only, no embedded bodies). */
export interface SubAgentArtifact {
  kind: 'path' | 'url' | 'note';
  label: string;
  ref: string;
  mime?: string;
}

/** Machine-readable handoff returned to the parent tool loop. */
export interface SubAgentStructuredOutcome {
  summary: string;
  findings: SubAgentFinding[];
  artifacts: SubAgentArtifact[];
}

/** Short budget event label for drawer / status (no full truncated bodies). */
export interface SubAgentBudgetEvent {
  turn: number;
  label: string;
  estimatedTokens?: number;
}

const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

/** Extract JSON object text from model output (fenced or whole body). */
export function extractJsonTextFromAssistantBody(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(JSON_FENCE_RE);
  if (fence?.[1]) return fence[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/** Parse assistant text into unknown JSON value. */
export function parseStructuredOutcomeJson(text: string): unknown {
  const jsonText = extractJsonTextFromAssistantBody(text);
  return JSON.parse(jsonText) as unknown;
}

/**
 * Validate parsed JSON against the configured summary schema preset.
 */
export function validateStructuredOutcome(
  raw: unknown,
  schemaId: string | undefined | null,
): SubAgentStructuredOutcome | null {
  const preset = resolveSummarySchemaPreset(schemaId);
  return validateStructuredOutcomeForPreset(raw, preset);
}

/** Build outcome from legacy prose summary when structured data is absent. */
export function legacyOutcomeFromSummary(summary: string): SubAgentStructuredOutcome {
  const text = summary.trim() || 'Sub-agent completed with no text output.';
  return { summary: text, findings: [], artifacts: [] };
}

/**
 * When the work turn already returned valid outcome JSON in assistant prose, accept it
 * and skip a separate finalization completion (avoids empty final-turn provider quirks).
 */
export function tryParseStructuredOutcomeFromAssistantProse(
  text: string,
  schemaId: string | undefined | null,
): SubAgentStructuredOutcome | null {
  const trimmed = text.trim();
  if (!trimmed || !trimmed.includes('{') || !trimmed.includes('summary')) {
    return null;
  }
  try {
    const parsed = parseStructuredOutcomeJson(trimmed);
    return validateStructuredOutcome(parsed, schemaId);
  } catch {
    return null;
  }
}

/** Instruction appended on the final non-tool turn. */
export function buildSubAgentFinalizationPrompt(schemaId: string | undefined | null): string {
  const preset = resolveSummarySchemaPreset(schemaId);
  const findingsRule =
    preset.maxFindings === 0
      ? 'Return an empty findings array.'
      : `Include up to ${preset.maxFindings} findings with title and detail strings.`;
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
- Artifacts are references only (paths, URLs, notes) — never embed large file bodies.
- Do not call tools in this message.`;
}

/** Single repair instruction after invalid JSON. */
export const SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT =
  'Your previous message was not valid JSON for the required outcome schema. Reply with ONLY valid JSON matching the schema (summary, findings, artifacts). No prose.';

/** Default schema id when type config omits summarySchema. */
export { DEFAULT_SUB_AGENT_SUMMARY_SCHEMA };
