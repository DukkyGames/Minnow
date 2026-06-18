/**
 * LLM skill draft extraction for skill proposals (Odysseus port #08).
 */

import { llmCall } from '../research/llm.js';
import { parseSkillFrontmatter } from '../skills/parse-frontmatter.js';
import { listMergedSkills } from '../skills/scan.js';
import { getAppRoot } from '../workspace/root.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { addSkillProposal } from '../skills/proposals.js';
import { formatMessagesForExtraction } from './synthesis.js';

/** Recent messages for skill extraction (longer than fact window). */
export const SKILL_CONTEXT_WINDOW = 12;

export const SKILL_EXTRACT_PROMPT = `You are analyzing an AI agent's work session. The agent took {rounds} rounds and {tool_count} tool calls to complete the task.

Extract a reusable "skill" ONLY IF the session contains a concrete, repeatable procedure the agent could follow to solve a similar problem ON THE COMPUTER next time (e.g. a sequence of shell commands, code, file edits, API calls, or tool usage).

Return null (the bare word, no JSON) when the session is NOT a reusable computer procedure, including:
- The real work happened OUTSIDE the computer
- A one-off, personal, or context-specific task that won't recur
- A pure question/answer or explanation with no transferable method
- The agent failed, gave up, or the approach is not worth repeating

When (and only when) a genuine reusable procedure exists, return a JSON object with:
- "title": short name (under 10 words)
- "problem": what was the challenge (1-2 sentences)
- "solution": what worked (1-2 sentences)
- "steps": array of step-by-step instructions (3-7 short steps)
- "tags": array of relevant keywords (3-5 tags)
- "confidence": 0.0-1.0 how reliable AND reusable this procedure is

Be conservative: if in doubt, return null.
Return ONLY valid JSON (or the bare word null), no markdown fences.`;

/**
 * Best-effort JSON object extraction (handles stray braces before the real object).
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
export function parseSkillExtractionJson(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let s = raw.trim();
  if (s.toLowerCase() === 'null') return null;
  if (s.startsWith('```')) {
    s = s.includes('\n') ? s.slice(s.indexOf('\n') + 1) : s.slice(3);
    const close = s.lastIndexOf('```');
    if (close >= 0) s = s.slice(0, close).trim();
  }

  const end = s.lastIndexOf('}');
  if (end === -1) return null;

  const asObject = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? /** @type {Record<string, unknown>} */ (parsed)
        : null;
    } catch {
      return null;
    }
  };

  const whole = asObject(s);
  if (whole) return whole;

  let start = s.indexOf('{');
  while (start >= 0 && start < end) {
    const obj = asObject(s.slice(start, end + 1));
    if (obj) return obj;
    start = s.indexOf('{', start + 1);
  }

  return null;
}

/**
 * @param {string} title
 * @returns {string}
 */
export function slugifySkillId(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'learned-skill';
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function buildSkillMdDraft(data) {
  const title = String(data.title ?? '').trim();
  const id = slugifySkillId(title);
  const description = String(data.solution ?? data.problem ?? title).trim();
  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const steps = Array.isArray(data.steps)
    ? data.steps.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const triggers = tags.length ? tags.join(', ') : title;
  const bodyLines = [
    `# ${title}`,
    '',
    String(data.problem ?? '').trim() ? `## Problem\n\n${String(data.problem).trim()}` : '',
    String(data.solution ?? '').trim() ? `## Solution\n\n${String(data.solution).trim()}` : '',
    steps.length
      ? `## Steps\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '',
  ].filter(Boolean);

  return `---
name: ${id}
label: ${title}
description: >-
  ${description.replace(/\s+/g, ' ').slice(0, 240)}
triggers: ${triggers}
---

${bodyLines.join('\n\n').trim()}
`;
}

/**
 * @param {string} draft
 * @returns {boolean}
 */
export function validateSkillMdDraft(draft) {
  try {
    parseSkillFrontmatter(draft);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} title
 * @param {string} projectRoot
 * @returns {Promise<boolean>}
 */
export async function hasDuplicateSkillTitle(title, projectRoot) {
  const wanted = title.toLowerCase();
  const skills = await listMergedSkills(projectRoot);
  return skills.some((s) => String(s.label ?? s.name ?? '').toLowerCase() === wanted);
}

/**
 * @param {{
 *   messages: Array<{ role?: string, content?: string | unknown[] }>,
 *   roundCount: number,
 *   toolCount: number,
 *   sourceChatId?: string,
 * }} input
 * @returns {Promise<{ skillProposal: object | null, skipped: string[] }>}
 */
export async function runSkillSynthesis(input) {
  const cfg = await loadSynthesisConfig();
  const skipped = [];
  if (!cfg.enabled) {
    return { skillProposal: null, skipped: ['disabled'] };
  }

  const minRounds = cfg.skillMinRounds ?? 2;
  const minTools = cfg.skillMinToolCalls ?? 2;
  if (input.roundCount < minRounds && input.toolCount < minTools) {
    return { skillProposal: null, skipped: ['below-threshold'] };
  }

  const modelBinding = await resolveSynthesisModel(cfg);
  if (!modelBinding?.providerId || !modelBinding?.model) {
    return { skillProposal: null, skipped: ['no-model'] };
  }

  const recent = (input.messages ?? []).slice(-SKILL_CONTEXT_WINDOW);
  const conversation = formatMessagesForExtraction(recent);
  if (!conversation.trim()) {
    return { skillProposal: null, skipped: ['empty-context'] };
  }

  const prompt = SKILL_EXTRACT_PROMPT.replace('{rounds}', String(input.roundCount))
    .replace('{tool_count}', String(input.toolCount));

  const raw = await llmCall({
    providerId: modelBinding.providerId,
    model: modelBinding.model,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `Conversation:\n${conversation}` },
    ],
    temperature: 0.2,
    maxTokens: 2048,
    timeoutMs: 45_000,
  });

  if (!raw || raw.trim().toLowerCase() === 'null') {
    return { skillProposal: null, skipped: ['llm-declined'] };
  }

  const data = parseSkillExtractionJson(raw);
  if (!data) {
    return { skillProposal: null, skipped: ['parse-failed'] };
  }

  const title = String(data.title ?? '').trim();
  if (!title) {
    return { skillProposal: null, skipped: ['no-title'] };
  }

  let confidence = 0.7;
  if (typeof data.confidence === 'number' && Number.isFinite(data.confidence)) {
    confidence = Math.min(1, Math.max(0, data.confidence));
  }
  const threshold = cfg.confidenceThreshold ?? 0.6;
  if (confidence < threshold) {
    return { skillProposal: null, skipped: ['low-confidence'] };
  }

  const projectRoot = getAppRoot();
  if (await hasDuplicateSkillTitle(title, projectRoot)) {
    return { skillProposal: null, skipped: ['duplicate-skill'] };
  }

  const skillMdDraft = buildSkillMdDraft(data);
  if (!validateSkillMdDraft(skillMdDraft)) {
    return { skillProposal: null, skipped: ['invalid-skill-md'] };
  }

  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  const proposal = await addSkillProposal({
    title,
    skillMdDraft,
    tags,
    confidence,
    rationale: String(data.solution ?? data.problem ?? '').slice(0, 500),
    sourceChatId: input.sourceChatId,
  });

  return { skillProposal: proposal, skipped };
}
