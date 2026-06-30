/**
 * Super Plan review pass helpers (Phase 5 — plan-reviewer tasks + UI heuristic).
 */

/** Review passes run sequentially; pass 2 receives pass 1 critique. */
export const SUPER_PLAN_REVIEW_PASSES = [1, 2] as const;

export type SuperPlanReviewPass = (typeof SUPER_PLAN_REVIEW_PASSES)[number];

export interface SuperPlanReviewContext {
  draftPlan: string;
  spec?: string;
  research?: string;
  buildSpecPath?: string;
  researchArtifactPath?: string;
  planPath?: string;
}

export interface PlanReviewerTaskInput extends SuperPlanReviewContext {
  pass: SuperPlanReviewPass;
  /** Total review passes configured (defaults to SUPER_PLAN_REVIEW_PASSES.length). */
  reviewRounds?: number;
  /** Structured summary or JSON from pass 1 — required for pass 2 when available. */
  priorCritique?: string;
}

/** UI-related signals in spec, research, or draft plan text. */
const UI_INVOLVEMENT_PATTERNS: readonly RegExp[] = [
  /\bcomponents?\b/i,
  /(?<!\/)\broutes?\b/i,
  /\bcss\b/i,
  /\bstyles?\b/i,
  /\bui\b/i,
  /\bux\b/i,
  /\bfrontend\b/i,
  /\blayout\b/i,
  /\bdashboard\b/i,
  /\bmodal\b/i,
  /\bbutton\b/i,
  /\btheme\b/i,
  /\bwidget\b/i,
  /\binterface\b/i,
  /\bscreen\b/i,
  /\bpage\b/i,
  /\bdesign\b/i,
  /\btokens?\.css\b/i,
  /\bindex\.html\b/i,
  /\bsrc\/ui\b/i,
  /\bsrc\/styles\b/i,
  /\bsrc\/components\b/i,
  /#\w+/,
  /\bimpeccable\b/i,
  /\bui-designer\b/i,
];

/**
 * Heuristic: true when spec/research/plan text suggests UI work.
 * Used to decide whether to run the optional Impeccable shape/critique stage.
 */
export function planInvolvesUi(...texts: (string | undefined | null)[]): boolean {
  const combined = texts
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .join('\n');
  if (!combined.trim()) return false;
  return UI_INVOLVEMENT_PATTERNS.some((re) => re.test(combined));
}

function section(title: string, body: string | undefined): string {
  const trimmed = body?.trim();
  if (!trimmed) return '';
  return `\n## ${title}\n\n${trimmed}\n`;
}

/**
 * Build the task envelope for a plan-reviewer sub-agent spawn.
 * Pass 2 includes pass-1 critique so the reviewer can verify fixes and hunt for misses.
 */
export function buildPlanReviewerTask(input: PlanReviewerTaskInput): string {
  const totalPasses = input.reviewRounds ?? SUPER_PLAN_REVIEW_PASSES.length;
  const lines: string[] = [
    `# Plan review — pass ${input.pass} of ${totalPasses}`,
    '',
  ];

  if (input.pass === 2) {
    if (input.priorCritique?.trim()) {
      lines.push(
        '## Pass 1 critique (re-check every item; note resolved vs still open)',
        '',
        input.priorCritique.trim(),
        '',
        'Pass 2 goals: confirm pass-1 issues are addressed in the draft, find gaps pass 1 missed, and avoid repeating resolved findings unless they regressed.',
        '',
      );
    } else {
      lines.push(
        'Pass 1 did not return structured critique. Perform a fresh independent review with extra focus on dependency ordering and codebase path accuracy.',
        '',
      );
    }
  } else {
    lines.push(
      'Pass 1: produce a thorough structured critique (findings with suggested plan edits).',
      '',
    );
  }

  if (input.buildSpecPath) {
    lines.push(`Build spec path: \`${input.buildSpecPath}\``, '');
  }
  if (input.researchArtifactPath) {
    lines.push(`Research artifact path: \`${input.researchArtifactPath}\``, '');
  }
  if (input.planPath) {
    lines.push(`Draft plan path: \`${input.planPath}\``, '');
  }

  const contextBlock =
    section('Build spec', input.spec) +
    section('Research artifact', input.research) +
    section('Draft plan', input.draftPlan);

  if (contextBlock.trim()) {
    lines.push(contextBlock.trimEnd());
  }

  return lines.join('\n').trimEnd();
}

/** Serialize structured review outcome for pass-2 task input. */
export function formatReviewCritiqueForPass2(
  summary: string,
  findingsJson?: string,
): string {
  const parts = [summary.trim()];
  if (findingsJson?.trim()) {
    parts.push('', findingsJson.trim());
  }
  return parts.join('\n').trim();
}
