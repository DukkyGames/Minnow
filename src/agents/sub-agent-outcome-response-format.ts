/**
 * Optional `response_format` for the sub-agent finalization turn (structured outcome JSON).
 */

import type { ResponseFormat } from '../providers/completion-types';
import { resolveSummarySchemaPreset } from './sub-agent-summary-schemas';

/** Build OpenAI-style json_schema for {@link SubAgentStructuredOutcome} handoff. */
export function buildSubAgentOutcomeResponseFormat(
  schemaId: string | null | undefined,
): ResponseFormat | null {
  const preset = resolveSummarySchemaPreset(schemaId);
  const maxFindings = Math.min(30, Math.max(0, preset.maxFindings));
  const maxArtifacts = Math.min(30, Math.max(0, preset.maxArtifacts));

  const findingItem: Record<string, unknown> = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      detail: { type: 'string' },
      severity: { type: 'string', enum: ['info', 'warn', 'blocker'] },
      paths: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'detail'],
    additionalProperties: false,
  };

  const artifactItem: Record<string, unknown> = {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['path', 'url', 'reef-widget', 'note'] },
      label: { type: 'string' },
      ref: { type: 'string' },
      mime: { type: 'string' },
    },
    required: ['kind', 'label', 'ref'],
    additionalProperties: false,
  };

  return {
    type: 'json_schema',
    json_schema: {
      name: 'minnow_sub_agent_outcome',
      strict: false,
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          findings: {
            type: 'array',
            items: findingItem,
            minItems: 0,
            maxItems: maxFindings,
          },
          artifacts: {
            type: 'array',
            items: artifactItem,
            minItems: 0,
            maxItems: maxArtifacts,
          },
        },
        required: ['summary', 'findings', 'artifacts'],
        additionalProperties: false,
      },
    },
  };
}
