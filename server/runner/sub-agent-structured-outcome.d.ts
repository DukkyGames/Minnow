/**
 * Parse, validate, and repair sub-agent structured final outcomes (MIN-43).
 */
import { DEFAULT_SUB_AGENT_SUMMARY_SCHEMA } from './sub-agent-summary-schemas.js';
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
/** Extract JSON object text from model output (fenced or whole body). */
export declare function extractJsonTextFromAssistantBody(text: string): string;
/** Parse assistant text into unknown JSON value. */
export declare function parseStructuredOutcomeJson(text: string): unknown;
/**
 * Validate parsed JSON against the configured summary schema preset.
 */
export declare function validateStructuredOutcome(raw: unknown, schemaId: string | undefined | null): SubAgentStructuredOutcome | null;
/** Build outcome from legacy prose summary when structured data is absent. */
export declare function legacyOutcomeFromSummary(summary: string): SubAgentStructuredOutcome;
/**
 * When the work turn already returned valid outcome JSON in assistant prose, accept it
 * and skip a separate finalization completion (avoids empty final-turn provider quirks).
 */
export declare function tryParseStructuredOutcomeFromAssistantProse(text: string, schemaId: string | undefined | null): SubAgentStructuredOutcome | null;
/** Instruction appended on the final non-tool turn. */
export declare function buildSubAgentFinalizationPrompt(schemaId: string | undefined | null): string;
/** Single repair instruction after invalid JSON. */
export declare const SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT = "Your previous message was not valid JSON for the required outcome schema. Reply with ONLY valid JSON matching the schema (summary, findings, artifacts). No prose.";
/** Default schema id when type config omits summarySchema. */
export { DEFAULT_SUB_AGENT_SUMMARY_SCHEMA };
