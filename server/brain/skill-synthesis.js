/**
 * LLM skill draft extraction for skill proposals (Odysseus port #08).
 */

import { llmCall } from '../research/llm.js';
import { parseSkillFrontmatter } from '../skills/parse-frontmatter.js';
import { listMergedSkills } from '../skills/scan.js';
import { getAppRoot } from '../workspace/root.js';
import { loadSynthesisConfig, resolveSynthesisModel } from './synthesis-config.js';
import { addSkillProposal, listSkillProposals } from '../skills/proposals.js';
import { formatMessagesForExtraction } from './synthesis.js';
import {
  DEFAULT_MATCH_THRESHOLD,
  addSkillObservation,
  countDistinctSessions,
  findMatchingObservations,
  markObservationsProposed,
  matchScore,
} from '../skills/observations.js';

/** Recent messages for skill extraction (longer than fact window). */
export const SKILL_CONTEXT_WINDOW = 12;

export const SKILL_OBSERVE_PROMPT = `You are analyzing an AI agent's work session. The agent took {rounds} rounds and {tool_count} tool calls to complete the task.

Extract a reusable "skill" ONLY IF the session contains a concrete, repeatable procedure the agent could follow to solve a similar problem ON THE COMPUTER next time (e.g. a sequence of shell commands, code, file edits, API calls, or tool usage).

Return null (the bare word, no JSON) when the session is NOT a reusable computer procedure, including:
- The real work happened OUTSIDE the computer
- A one-off, personal, or context-specific task that won't recur
- **You would not expect this user to face this same kind of problem again** — ask yourself whether this is a problem CLASS or a single incident
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
 * Second-stage prompt: turn several observations of the same problem class into
 * one skill. Written to fight the failure mode of the old single-session
 * pipeline, which proposed skills so specific to one incident (exact paths, one
 * error string) that they never matched anything again.
 */
export const SKILL_GENERALIZE_PROMPT = `You are writing ONE reusable skill from several separate sessions where an AI agent solved the same class of problem.

You will receive:
- "occurrences": the recorded observations, each from a different session
- "existingSkills": titles of skills that already exist or are already proposed or were rejected

Your job:
1. Find the INVARIANT procedure — the part that was the same every time. Discard what was incidental to one session.
2. PARAMETERIZE anything session-specific: file paths, project or package names, ports, host names, exact error strings, line numbers. Describe them as placeholders (e.g. "<config file>", "<port>") and say how to determine each one.
3. Title the skill by the PROBLEM CLASS, not the instance. "Pin a dev server to a fixed port" — not "Fix Vite port 5173 conflict in Minnow".
4. Do NOT propose a skill that overlaps an entry in "existingSkills". If the invariant procedure is already covered by one of them, return null.

Return null (the bare word, no JSON) if the occurrences do not actually share a procedure, or if the shared part is too thin to be useful.

Otherwise return a JSON object with:
- "title": short name for the problem class (under 10 words)
- "problem": the recurring challenge (1-2 sentences)
- "solution": the invariant approach (1-2 sentences)
- "steps": array of step-by-step instructions (3-7 short steps), parameterized
- "tags": array of relevant keywords (3-5 tags)
- "confidence": 0.0-1.0 how reliable AND reusable this generalized procedure is

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
 * Every title a new skill could collide with: installed/merged skills plus
 * pending and rejected proposals.
 * @returns {Promise<string[]>}
 */
export async function collectKnownSkillTitles() {
  const titles = [];
  try {
    for (const skill of await listMergedSkills(getAppRoot())) {
      const label = String(skill.label ?? skill.name ?? '').trim();
      if (label) titles.push(label);
    }
  } catch {
    /* best-effort — a scan failure must not block the pipeline */
  }
  try {
    for (const row of await listSkillProposals()) {
      if (row.status === 'pending' || row.status === 'rejected') {
        const title = String(row.title ?? '').trim();
        if (title) titles.push(title);
      }
    }
  } catch {
    /* best-effort */
  }
  return titles;
}

/** Jaccard bar above which two skill titles are treated as the same skill. */
export const SKILL_DUPLICATE_THRESHOLD = 0.6;

/**
 * True when a candidate title duplicates an existing, pending, or rejected skill.
 *
 * Checks all three because the old exact-match-against-merged-skills-only rule
 * meant a rejected proposal could be re-proposed forever: rejecting it never
 * created a merged skill, so nothing ever matched.
 *
 * @param {string} title
 * @param {string[]} knownTitles merged skill labels + pending + rejected proposal titles
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function isDuplicateSkillCandidate(title, knownTitles, threshold = SKILL_DUPLICATE_THRESHOLD) {
  const wanted = String(title ?? '').trim().toLowerCase();
  if (!wanted) return false;

  for (const known of knownTitles ?? []) {
    const other = String(known ?? '').trim().toLowerCase();
    if (!other) continue;
    if (other === wanted) return true;
    if (matchScore({ title: wanted }, { title: other }) >= threshold) return true;
  }
  return false;
}

/**
 * Observe a session, and propose a generalized skill only once the same problem
 * class has recurred across enough distinct sessions.
 *
 * Three stages:
 *   1. **Observe** — extract a candidate from this session and record it.
 *   2. **Recurrence check** — stop unless `skillMinOccurrences` distinct sessions
 *      have produced a matching candidate.
 *   3. **Generalize** — merge the matched occurrences into one parameterized skill.
 *
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

  // AND, not OR. The old `rounds < min && tools < min` fired on nearly every
  // turn, because clearing either bar alone was enough to pass.
  const minRounds = cfg.skillMinRounds ?? 2;
  const minTools = cfg.skillMinToolCalls ?? 2;
  if (input.roundCount < minRounds || input.toolCount < minTools) {
    return { skillProposal: null, skipped: ['below-threshold'] };
  }

  const modelBinding = await resolveSynthesisModel(cfg);
  if (!modelBinding?.providerId || !modelBinding?.model) {
    return { skillProposal: null, skipped: ['no-model'] };
  }

  // The window must be passed through: formatMessagesForExtraction used to
  // re-slice to the narrower fact window internally, so this never saw more
  // than 6 messages despite SKILL_CONTEXT_WINDOW being 12.
  const conversation = formatMessagesForExtraction(input.messages ?? [], {
    window: SKILL_CONTEXT_WINDOW,
  });
  if (!conversation.trim()) {
    return { skillProposal: null, skipped: ['empty-context'] };
  }

  // --- Stage 1: observe this session ---------------------------------------

  const observePrompt = SKILL_OBSERVE_PROMPT.replace('{rounds}', String(input.roundCount))
    .replace('{tool_count}', String(input.toolCount));

  const raw = await llmCall({
    providerId: modelBinding.providerId,
    model: modelBinding.model,
    messages: [
      { role: 'system', content: observePrompt },
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

  const knownTitles = await collectKnownSkillTitles();
  if (isDuplicateSkillCandidate(title, knownTitles)) {
    // Already covered, already queued, or already rejected — don't even observe.
    return { skillProposal: null, skipped: ['duplicate-skill'] };
  }

  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const retentionDays = cfg.skillObservationRetentionDays ?? 45;

  const observation = await addSkillObservation(
    {
      title,
      problem: String(data.problem ?? ''),
      solution: String(data.solution ?? ''),
      steps: Array.isArray(data.steps) ? data.steps.map(String) : [],
      tags,
      confidence,
      sourceChatId: input.sourceChatId,
    },
    { retentionDays },
  );

  // --- Stage 2: has this recurred? -----------------------------------------

  const matches = await findMatchingObservations(
    { title, tags },
    DEFAULT_MATCH_THRESHOLD,
    { retentionDays },
  );
  // findMatchingObservations reads from disk, so the row just written is
  // included; guard anyway in case the store write is ever made async.
  const occurrences = matches.some((row) => row.id === observation.id)
    ? matches
    : [...matches, observation];

  const minOccurrences = cfg.skillMinOccurrences ?? 2;
  if (countDistinctSessions(occurrences) < minOccurrences) {
    return { skillProposal: null, skipped: ['observed'] };
  }

  // --- Stage 3: generalize across the occurrences --------------------------

  const generalizeRaw = await llmCall({
    providerId: modelBinding.providerId,
    model: modelBinding.model,
    messages: [
      { role: 'system', content: SKILL_GENERALIZE_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          occurrences: occurrences.map((row) => ({
            title: row.title,
            problem: row.problem,
            solution: row.solution,
            steps: row.steps,
            tags: row.tags,
          })),
          existingSkills: knownTitles,
        }),
      },
    ],
    temperature: 0.2,
    maxTokens: 2048,
    timeoutMs: 45_000,
  });

  if (!generalizeRaw || generalizeRaw.trim().toLowerCase() === 'null') {
    return { skillProposal: null, skipped: ['generalize-declined'] };
  }

  const generalized = parseSkillExtractionJson(generalizeRaw);
  if (!generalized) {
    return { skillProposal: null, skipped: ['generalize-parse-failed'] };
  }

  const finalTitle = String(generalized.title ?? '').trim();
  if (!finalTitle) {
    return { skillProposal: null, skipped: ['no-title'] };
  }
  if (isDuplicateSkillCandidate(finalTitle, knownTitles)) {
    return { skillProposal: null, skipped: ['duplicate-skill'] };
  }

  let finalConfidence = confidence;
  if (
    typeof generalized.confidence === 'number' &&
    Number.isFinite(generalized.confidence)
  ) {
    finalConfidence = Math.min(1, Math.max(0, generalized.confidence));
  }
  if (finalConfidence < threshold) {
    return { skillProposal: null, skipped: ['low-confidence'] };
  }

  const skillMdDraft = buildSkillMdDraft(generalized);
  if (!validateSkillMdDraft(skillMdDraft)) {
    return { skillProposal: null, skipped: ['invalid-skill-md'] };
  }

  const finalTags = Array.isArray(generalized.tags)
    ? generalized.tags.map((t) => String(t).trim()).filter(Boolean)
    : tags;

  const proposal = await addSkillProposal({
    title: finalTitle,
    skillMdDraft,
    tags: finalTags,
    confidence: finalConfidence,
    rationale: String(generalized.solution ?? generalized.problem ?? '').slice(0, 500),
    sourceChatId: input.sourceChatId,
  });

  // Consume the occurrences so the next session doesn't re-propose from them.
  await markObservationsProposed(occurrences.map((row) => row.id));

  return { skillProposal: proposal, skipped };
}
