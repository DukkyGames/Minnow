/**
 * Optional `response_format` for the sub-agent finalization turn (structured outcome JSON).
 */
import type { ResponseFormat } from '../../src/providers/completion-types.js';
/** Build OpenAI-style json_schema for {@link SubAgentStructuredOutcome} handoff. */
export declare function buildSubAgentOutcomeResponseFormat(schemaId: string | null | undefined): ResponseFormat | null;
