/**
 * Preset JSON outcome schemas for sub-agent final-turn validation (MIN-43).
 */

import type { SubAgentStructuredOutcome } from './sub-agent-structured-outcome';

/** Shipped default schema id for parent handoff. */
export const DEFAULT_SUB_AGENT_SUMMARY_SCHEMA = 'minnow.sub-agent.v1';

const VALID_SEVERITIES = new Set(['info', 'warn', 'blocker']);
const VALID_ARTIFACT_KINDS = new Set(['path', 'url', 'note']);

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
export const SUB_AGENT_SUMMARY_SCHEMA_PRESETS: Record<string, SummarySchemaPreset> = {
  'minnow.sub-agent.v1': {
    id: 'minnow.sub-agent.v1',
    label: 'Standard (summary + findings + artifacts)',
    maxFindings: 20,
    maxArtifacts: 20,
    maxSummaryChars: 2000,
    maxDetailChars: 4000,
    requireFindings: false,
  },
  'minnow.sub-agent.lite': {
    id: 'minnow.sub-agent.lite',
    label: 'Lite (summary + artifacts only)',
    maxFindings: 0,
    maxArtifacts: 20,
    maxSummaryChars: 1200,
    maxDetailChars: 0,
    requireFindings: false,
  },
  'minnow.sub-agent.explore': {
    id: 'minnow.sub-agent.explore',
    label: 'Explore (findings-heavy)',
    maxFindings: 30,
    maxArtifacts: 10,
    maxSummaryChars: 1500,
    maxDetailChars: 6000,
    requireFindings: false,
  },
};

/** Resolve preset id; unknown ids fall back to the default v1 preset. */
export function resolveSummarySchemaPreset(schemaId: string | undefined | null): SummarySchemaPreset {
  const key = (schemaId ?? '').trim() || DEFAULT_SUB_AGENT_SUMMARY_SCHEMA;
  return SUB_AGENT_SUMMARY_SCHEMA_PRESETS[key] ?? SUB_AGENT_SUMMARY_SCHEMA_PRESETS[DEFAULT_SUB_AGENT_SUMMARY_SCHEMA];
}

/** List preset ids for settings dropdowns. */
export function listSummarySchemaPresetIds(): string[] {
  return Object.keys(SUB_AGENT_SUMMARY_SCHEMA_PRESETS);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/**
 * Validate and normalize a parsed JSON object against a summary schema preset.
 * Returns null when validation fails.
 */
export function validateStructuredOutcomeForPreset(
  raw: unknown,
  preset: SummarySchemaPreset,
): SubAgentStructuredOutcome | null {
  if (!isPlainObject(raw)) return null;

  const summary = readString(raw.summary, preset.maxSummaryChars);
  if (!summary) return null;

  const findingsRaw = raw.findings;
  const artifactsRaw = raw.artifacts;
  if (!Array.isArray(findingsRaw) || !Array.isArray(artifactsRaw)) return null;

  if (findingsRaw.length > preset.maxFindings) return null;
  if (artifactsRaw.length > preset.maxArtifacts) return null;
  if (preset.maxFindings === 0 && findingsRaw.length > 0) return null;

  const findings = [];
  for (const item of findingsRaw) {
    if (!isPlainObject(item)) return null;
    const title = readString(item.title, 240);
    const detail = readString(item.detail, preset.maxDetailChars);
    if (!title || !detail) return null;
    const finding: SubAgentStructuredOutcome['findings'][number] = {
      title,
      detail,
    };
    if (typeof item.id === 'string' && item.id.trim()) {
      finding.id = item.id.trim().slice(0, 64);
    }
    if (typeof item.severity === 'string' && VALID_SEVERITIES.has(item.severity)) {
      finding.severity = item.severity as 'info' | 'warn' | 'blocker';
    }
    if (Array.isArray(item.paths)) {
      const paths = item.paths
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map((p) => p.trim().slice(0, 512))
        .slice(0, 16);
      if (paths.length) finding.paths = paths;
    }
    findings.push(finding);
  }

  if (preset.requireFindings && findings.length === 0) return null;

  const artifacts = [];
  for (const item of artifactsRaw) {
    if (!isPlainObject(item)) return null;
    const kind = typeof item.kind === 'string' ? item.kind : '';
    if (!VALID_ARTIFACT_KINDS.has(kind)) return null;
    const label = readString(item.label, 240);
    const ref = readString(item.ref, 1024);
    if (!label || !ref) return null;
    const artifact: SubAgentStructuredOutcome['artifacts'][number] = {
      kind: kind as 'path' | 'url' | 'note',
      label,
      ref,
    };
    if (typeof item.mime === 'string' && item.mime.trim()) {
      artifact.mime = item.mime.trim().slice(0, 128);
    }
    artifacts.push(artifact);
  }

  return { summary, findings, artifacts };
}
