/**
 * Pure helpers for Super Plan parsing and validation (testable without DOM).
 */

import type {
  SuperPlanProgress,
  SuperPlanQuestion,
  SuperPlanQuestionnaireAnswers,
  SuperPlanStage,
} from './types';

/** Strip markdown code fences from LLM output. */
export function stripCodeFence(text: string): string {
  let out = String(text ?? '').trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json|markdown|md)?\s*/i, '');
    out = out.replace(/\s*```$/, '');
  }
  return out.trim();
}

/** Parse intake questionnaire JSON from a sub-agent summary. */
export function parseQuestionnaireJson(text: string): SuperPlanQuestion[] | null {
  const body = stripCodeFence(text);
  const candidates: string[] = [body];

  const objectMatch = body.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    candidates.push(objectMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { questions?: unknown };
      if (!parsed || !Array.isArray(parsed.questions)) {
        continue;
      }
      const questions: SuperPlanQuestion[] = [];
      for (const raw of parsed.questions) {
        if (!raw || typeof raw !== 'object') {
          continue;
        }
        const item = raw as Record<string, unknown>;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
        const kind = item.kind;
        if (!id || !prompt) {
          continue;
        }
        if (kind !== 'single' && kind !== 'multi' && kind !== 'text') {
          continue;
        }
        const options = Array.isArray(item.options)
          ? item.options.map((opt) => String(opt).trim()).filter(Boolean)
          : undefined;
        if ((kind === 'single' || kind === 'multi') && (!options || options.length === 0)) {
          continue;
        }
        questions.push({ id, prompt, kind, options });
      }
      if (questions.length > 0) {
        return questions;
      }
    } catch {
      /* try next candidate */
    }
  }

  return null;
}

/** Format questionnaire answers for spec-synthesis prompts. */
export function formatAnswersBlock(
  questions: SuperPlanQuestion[],
  answers: SuperPlanQuestionnaireAnswers,
): string {
  const lines: string[] = [];
  for (const q of questions) {
    const value = answers[q.id];
    if (value == null) {
      lines.push(`### ${q.prompt}\n(not answered)`);
      continue;
    }
    if (Array.isArray(value)) {
      lines.push(`### ${q.prompt}\n${value.join(', ')}`);
    } else {
      lines.push(`### ${q.prompt}\n${value}`);
    }
  }
  return lines.join('\n\n');
}

/**
 * Detect fenced or heavy inline code in plan markdown.
 * Super Plan plans must not contain implementation snippets.
 */
export function planContainsCodeSnippets(markdown: string): boolean {
  const text = String(markdown ?? '');
  if (/```[\s\S]*?```/.test(text)) {
    return true;
  }
  if (/^ {4}\S/m.test(text)) {
    return true;
  }
  const inlineTicks = text.match(/`[^`\n]+`/g) ?? [];
  for (const tick of inlineTicks) {
    const inner = tick.slice(1, -1);
    if (inner.length >= 12 && /[;{}()=<>]/.test(inner)) {
      return true;
    }
  }
  return false;
}

/** Slugify user prompt for default super-plan filenames. */
export function superPlanSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'plan';
}

/** Default draft path under documentation/plans/superplan/. */
export function defaultSuperPlanPath(userPrompt: string, revision = 0): string {
  const suffix = revision > 0 ? `-v${revision + 1}` : '';
  return `documentation/plans/superplan/super-${superPlanSlug(userPrompt)}${suffix}.md`;
}

/** Fold UI Designer guidance into the plan markdown body. */
export function foldUiGuidanceIntoPlan(planMarkdown: string, uiGuidance: string): string {
  const guidance = uiGuidance.trim();
  if (!guidance) {
    return planMarkdown.trim();
  }
  const body = planMarkdown.trim();
  if (body.toLowerCase().includes('## ui design guidance')) {
    return body;
  }
  return `${body}\n\n## UI design guidance\n\n${guidance}\n`;
}

export type SuperPlanReviseTarget = 'spec' | 'draft';

/** Decide whether revision should restart at spec or draft stage. */
export function resolveReviseTarget(notes?: string): SuperPlanReviseTarget {
  if (notes && /\b(spec|specification)\b/i.test(notes)) {
    return 'spec';
  }
  return 'draft';
}

/** Map pipeline stage to a progress event (optional message). */
export function superPlanStageToProgress(
  stage: SuperPlanStage,
  message?: string,
  extra: Partial<SuperPlanProgress> = {},
): SuperPlanProgress {
  const base = { stage, ...(message ? { message } : {}), ...extra };
  return base as SuperPlanProgress;
}

/** Extract a plan file path from planner sub-agent summary text. */
export function extractPlanPathFromSummary(summary: string): string | null {
  const text = String(summary ?? '');
  const patterns = [
    /documentation\/plans\/superplan\/[^\s`'"]+\.md/gi,
    /documentation\/plans\/super-[^\s`'"]+\.md/gi,
    /documentation\/plans\/[^\s`'"]+\.md/gi,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return match[0].replace(/[.,;:!?)]+$/, '');
    }
  }
  return null;
}
