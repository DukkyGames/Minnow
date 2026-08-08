/**
 * LLM wiki cleanup plan — diagnostics snapshot + structured review plan (no auto-apply).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { llmCall as defaultLlmCall } from '../../research/llm.js';
import { parseJsonObject, stripCodeBlock } from '../../research/json-parse.js';
import { collectWikiDiagnostics } from '../lint.js';
import { getBrainCleanupDir } from '../paths.js';
import { buildWikiCleanupSnapshot } from './snapshot.js';

/** Injectable deps for unit tests. */
export const cleanupPlanDeps = {
  llmCall: defaultLlmCall,
  collectWikiDiagnostics,
  buildWikiCleanupSnapshot,
};

const CLEANUP_PLAN_SYSTEM = `You are a conservative wiki librarian. Given diagnostics and a wiki snapshot, propose a human-review cleanup plan.

Reply with a single JSON object (no prose outside JSON) containing:
{
  "planVersion": 1,
  "planMarkdown": "Markdown plan with sections: Overview, Recommended actions, Execution order",
  "summary": {
    "deletes": [{ "path": "facts/old.md", "reason": "..." }],
    "merges": [{ "from": ["a.md"], "into": "b.md", "reason": "..." }],
    "linkFixes": [{ "from": "a.md", "target": "missing", "suggestion": "facts/new.md", "reason": "..." }],
    "staleActions": [{ "path": "a.md", "action": "archive|refresh|delete", "reason": "..." }],
    "anchorDrift": [{ "path": "a.md", "symbolIds": ["repo:Symbol"], "action": "resynthesize|mark-stale", "reason": "..." }],
    "risks": [{ "summary": "...", "mitigation": "..." }]
  }
}

Rules:
- Never recommend destructive deletes without explicit orphan/stale/contradiction evidence.
- Prefer merge + link fixes over deletion.
- planMarkdown must be actionable but safe (no shell commands).
- Return ONLY valid JSON.`;

const CLEANUP_JSON_REPAIR_PROMPT =
  'Your previous reply was not valid JSON matching the cleanup plan schema. Return ONLY the JSON object with planVersion, planMarkdown, and summary.';

/**
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
export function parseCleanupPlanJson(raw) {
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj !== 'object') return null;
  if (Number(obj.planVersion) !== 1) return null;
  if (typeof obj.planMarkdown !== 'string' || !obj.planMarkdown.trim()) return null;
  if (!obj.summary || typeof obj.summary !== 'object' || Array.isArray(obj.summary)) return null;
  return obj;
}

/**
 * @param {import('../../research/llm.js').LlmCallOptions} llmOptions
 * @param {string} snapshotJson
 */
async function callCleanupPlannerLlm(llmOptions, snapshotJson) {
  const llmCall = cleanupPlanDeps.llmCall;

  let completion = await llmCall({
    ...llmOptions,
    stripProse: true,
    messages: [
      { role: 'system', content: CLEANUP_PLAN_SYSTEM },
      {
        role: 'user',
        content: `Wiki snapshot JSON:\n${snapshotJson}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 8192,
    timeoutMs: 120_000,
  });

  let parsed = parseCleanupPlanJson(completion);
  if (parsed) return parsed;

  completion = await llmCall({
    ...llmOptions,
    stripProse: true,
    messages: [
      { role: 'system', content: CLEANUP_PLAN_SYSTEM },
      { role: 'user', content: `Wiki snapshot JSON:\n${snapshotJson}` },
      { role: 'assistant', content: stripCodeBlock(completion) },
      { role: 'user', content: CLEANUP_JSON_REPAIR_PROMPT },
    ],
    temperature: 0.1,
    maxTokens: 8192,
    timeoutMs: 120_000,
  });

  parsed = parseCleanupPlanJson(completion);
  if (!parsed) {
    const err = new Error('LLM returned invalid cleanup plan JSON');
    err.statusCode = 502;
    throw err;
  }
  return parsed;
}

/**
 * @param {Record<string, unknown>} record
 */
async function persistCleanupPlan(record) {
  const dir = getBrainCleanupDir();
  await fs.mkdir(dir, { recursive: true });
  const planId = String(record.planId);
  const filePath = path.join(dir, `${planId}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return filePath;
}

/**
 * Generate and persist a wiki cleanup plan.
 * @param {{ providerId: string, modelId: string, maxSnapshotChars?: number }} input
 */
export async function generateBrainCleanupPlan(input) {
  const providerId = String(input.providerId ?? '').trim();
  const modelId = String(input.modelId ?? '').trim();
  if (!providerId || !modelId) {
    const err = new Error('providerId and modelId are required');
    err.statusCode = 400;
    throw err;
  }

  const diagnostics = await cleanupPlanDeps.collectWikiDiagnostics();
  const { snapshot, snapshotHash } = await cleanupPlanDeps.buildWikiCleanupSnapshot({
    diagnostics,
    maxChars: input.maxSnapshotChars,
  });

  const snapshotJson = JSON.stringify(snapshot);
  const plan = await callCleanupPlannerLlm(
    { providerId, model: modelId },
    snapshotJson,
  );

  const planId = randomUUID();
  const createdAt = new Date().toISOString();
  const persisted = {
    planId,
    createdAt,
    providerId,
    modelId,
    diagnostics,
    snapshotHash,
    plan,
  };
  await persistCleanupPlan(persisted);

  return {
    planId,
    createdAt,
    snapshotHash,
    diagnostics,
    plan,
  };
}
