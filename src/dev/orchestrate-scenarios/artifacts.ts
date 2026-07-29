/**
 * Filesystem-neutral artifact records and sanitizers for scenario runners.
 */

export type SanitizedArtifactValue =
  | null
  | boolean
  | number
  | string
  | SanitizedArtifactValue[]
  | { [key: string]: SanitizedArtifactValue };

export interface ScenarioRunManifest {
  schemaVersion: 1;
  runId: string;
  scenarioId: string;
  seed: string;
  startedAt: string;
  iterationCount: number;
}

export interface ScenarioIterationArtifact {
  iteration: number;
  outcome:
    | 'passed'
    | 'expected_blocked'
    | 'unexpected_blocked'
    | 'timeout'
    | 'harness_error';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  violations: string[];
}

export interface SanitizedFakeModelRequest {
  at?: number;
  method?: string;
  url?: string;
  context?: {
    role?: string;
    taskId?: string;
    nth?: number;
  };
  body?: SanitizedArtifactValue;
}

export interface ScenarioArtifactBundle {
  manifest: ScenarioRunManifest;
  iterations: ScenarioIterationArtifact[];
  boardLog: SanitizedArtifactValue[];
  fakeModelRequests: SanitizedFakeModelRequest[];
  finalState?: SanitizedArtifactValue;
}

export interface ArtifactSanitizeOptions {
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
}

const SECRET_KEY =
  /authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|credential|private[-_]?key|headers?/i;
const CONTENT_KEY = /content|source|file|transcript|prompt|completion|messages?/i;
const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const DEFAULT_LIMITS = {
  maxDepth: 8,
  maxArrayItems: 100,
  maxObjectKeys: 100,
  maxStringLength: 4_096,
} as const;

function boundedString(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…${TRUNCATED}`;
}

function finiteNumber(value: number): number | string {
  if (Number.isFinite(value)) return value;
  return String(value);
}

/**
 * Recursively sanitize JSON-compatible artifact data with deterministic limits.
 */
export function sanitizeArtifactValue(
  value: unknown,
  options: ArtifactSanitizeOptions = {},
): SanitizedArtifactValue {
  const limits = {
    maxDepth: options.maxDepth ?? DEFAULT_LIMITS.maxDepth,
    maxArrayItems: options.maxArrayItems ?? DEFAULT_LIMITS.maxArrayItems,
    maxObjectKeys: options.maxObjectKeys ?? DEFAULT_LIMITS.maxObjectKeys,
    maxStringLength: options.maxStringLength ?? DEFAULT_LIMITS.maxStringLength,
  };
  for (const [key, limit] of Object.entries(limits)) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error(`Artifact sanitizer ${key} must be a positive integer`);
    }
  }

  const visit = (entry: unknown, depth: number, parentKey = ''): SanitizedArtifactValue => {
    if (entry === null) return null;
    if (typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') return finiteNumber(entry);
    if (typeof entry === 'string') {
      const stringLimit = CONTENT_KEY.test(parentKey)
        ? Math.min(limits.maxStringLength, 1_024)
        : limits.maxStringLength;
      return boundedString(entry, stringLimit);
    }
    if (typeof entry === 'bigint') return String(entry);
    if (typeof entry === 'undefined' || typeof entry === 'function' || typeof entry === 'symbol') {
      return String(entry);
    }
    if (depth >= limits.maxDepth) return TRUNCATED;
    if (Array.isArray(entry)) {
      const sanitized = entry
        .slice(0, limits.maxArrayItems)
        .map((item) => visit(item, depth + 1, parentKey));
      if (entry.length > limits.maxArrayItems) sanitized.push(TRUNCATED);
      return sanitized;
    }
    if (typeof entry !== 'object') return String(entry);

    const output: Record<string, SanitizedArtifactValue> = {};
    const entries = Object.entries(entry as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, limits.maxObjectKeys);
    for (const [key, child] of entries) {
      output[key] = SECRET_KEY.test(key) ? REDACTED : visit(child, depth + 1, key);
    }
    if (Object.keys(entry as Record<string, unknown>).length > limits.maxObjectKeys) {
      output[TRUNCATED] = true;
    }
    return output;
  };

  return visit(value, 0);
}

function sanitizedUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value, 'http://scenario.invalid');
    return `${url.pathname}${url.search ? '?[REDACTED]' : ''}`;
  } catch {
    return boundedString(value.trim().split(/[?#]/, 1)[0] ?? '', 512);
  }
}

/** Keep only request data useful for replay and remove headers, secrets, and query values. */
export function sanitizeFakeModelRequest(value: unknown): SanitizedFakeModelRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const output: SanitizedFakeModelRequest = {};
  if (typeof row.at === 'number' && Number.isFinite(row.at)) output.at = row.at;
  if (typeof row.method === 'string' && row.method.trim()) {
    output.method = boundedString(row.method.trim().toUpperCase(), 16);
  }
  const url = sanitizedUrl(row.url);
  if (url) output.url = url;

  if (row.context && typeof row.context === 'object' && !Array.isArray(row.context)) {
    const context = row.context as Record<string, unknown>;
    output.context = {};
    if (typeof context.role === 'string') {
      output.context.role = boundedString(context.role.trim(), 32);
    }
    if (typeof context.taskId === 'string') {
      output.context.taskId = boundedString(context.taskId.trim(), 128);
    }
    if (Number.isSafeInteger(context.nth) && Number(context.nth) >= 0) {
      output.context.nth = Number(context.nth);
    }
  }
  if ('body' in row) {
    output.body = sanitizeArtifactValue(row.body);
  }
  return output;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(row: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(row)) {
    if (!allowedSet.has(key)) throw new Error(`${label}.${key} is not allowed`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, label: string, positive = false): number {
  const minimum = positive ? 1 : 0;
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`${label} must be ${positive ? 'a positive' : 'a non-negative'} integer`);
  }
  return Number(value);
}

/** Strictly validate a run manifest before a runner writes it. */
export function parseScenarioRunManifest(value: unknown): ScenarioRunManifest {
  const row = objectRecord(value, 'manifest');
  exactKeys(
    row,
    ['schemaVersion', 'runId', 'scenarioId', 'seed', 'startedAt', 'iterationCount'],
    'manifest',
  );
  if (row.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1');
  return {
    schemaVersion: 1,
    runId: requiredString(row.runId, 'manifest.runId'),
    scenarioId: requiredString(row.scenarioId, 'manifest.scenarioId'),
    seed: requiredString(row.seed, 'manifest.seed'),
    startedAt: requiredString(row.startedAt, 'manifest.startedAt'),
    iterationCount: nonNegativeInteger(row.iterationCount, 'manifest.iterationCount', true),
  };
}

/** Strictly validate one iteration JSONL record. */
export function parseScenarioIterationArtifact(value: unknown): ScenarioIterationArtifact {
  const row = objectRecord(value, 'iteration');
  exactKeys(
    row,
    ['iteration', 'outcome', 'startedAt', 'finishedAt', 'durationMs', 'violations'],
    'iteration',
  );
  const outcomes: ScenarioIterationArtifact['outcome'][] = [
    'passed',
    'expected_blocked',
    'unexpected_blocked',
    'timeout',
    'harness_error',
  ];
  if (typeof row.outcome !== 'string' || !outcomes.includes(row.outcome as never)) {
    throw new Error(`iteration.outcome must be one of: ${outcomes.join(', ')}`);
  }
  if (!Array.isArray(row.violations)) {
    throw new Error('iteration.violations must be an array');
  }
  return {
    iteration: nonNegativeInteger(row.iteration, 'iteration.iteration', true),
    outcome: row.outcome as ScenarioIterationArtifact['outcome'],
    startedAt: requiredString(row.startedAt, 'iteration.startedAt'),
    finishedAt: requiredString(row.finishedAt, 'iteration.finishedAt'),
    durationMs: nonNegativeInteger(row.durationMs, 'iteration.durationMs'),
    violations: row.violations.map((entry, index) =>
      requiredString(entry, `iteration.violations[${index}]`),
    ),
  };
}

/** Build a sanitized in-memory bundle ready for a filesystem or HTTP adapter. */
export function sanitizeScenarioArtifactBundle(value: {
  manifest: unknown;
  iterations: unknown[];
  boardLog?: unknown[];
  fakeModelRequests?: unknown[];
  finalState?: unknown;
}): ScenarioArtifactBundle {
  return {
    manifest: parseScenarioRunManifest(value.manifest),
    iterations: value.iterations.map(parseScenarioIterationArtifact),
    boardLog: (value.boardLog ?? []).map((event) => sanitizeArtifactValue(event)),
    fakeModelRequests: (value.fakeModelRequests ?? []).map(sanitizeFakeModelRequest),
    ...('finalState' in value
      ? { finalState: sanitizeArtifactValue(value.finalState) }
      : {}),
  };
}
