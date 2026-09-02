import type { SubAgentStructuredOutcome } from './sub-agent-structured-outcome.js';
/** Shipped default schema id for parent handoff. */
export declare const DEFAULT_SUB_AGENT_SUMMARY_SCHEMA = "minnow.sub-agent.v1";
export interface SummarySchemaPreset {
    id: string;
    label: string;
    maxFindings: number;
    maxArtifacts: number;
    maxSummaryChars: number;
    maxDetailChars: number;
    requireFindings: boolean;
}
/** Registry of built-in summary schema presets. */
export declare const SUB_AGENT_SUMMARY_SCHEMA_PRESETS: Record<string, SummarySchemaPreset>;
/** Resolve preset id; unknown ids fall back to the default v1 preset. */
export declare function resolveSummarySchemaPreset(schemaId: string | undefined | null): SummarySchemaPreset;
/** List preset ids for settings dropdowns. */
export declare function listSummarySchemaPresetIds(): string[];
/**
 * Validate and normalize a parsed JSON object against a summary schema preset.
 * Returns null when validation fails.
 */
export declare function validateStructuredOutcomeForPreset(raw: unknown, preset: SummarySchemaPreset): SubAgentStructuredOutcome | null;
