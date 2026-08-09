/**
 * Super Plan artifact slugs — derived from build-spec / plan titles, not raw prompts.
 */

import { randomUUID } from '../../lib/random-id.ts';
import {
  superPlanPlanPath,
  superPlanResearchPath,
  superPlanSpecPath,
} from './state-paths';

const PLAN_SLUG_MAX_LEN = 50;

const GENERIC_PLAN_HEADINGS = new Set([
  'build spec',
  'build specification',
  'plan',
  'plan template',
  'executable plan',
  'implementation plan',
  'super plan',
  'spec',
  'specification',
  'overview',
  'summary',
  'untitled',
  'untitled plan',
]);

function normalizeHeadingForComparison(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericPlanHeading(text: string): boolean {
  const normalized = normalizeHeadingForComparison(text);
  if (!normalized) return true;
  return GENERIC_PLAN_HEADINGS.has(normalized);
}

/** Stable interim basename until the build spec title is known. */
export function createInterimPlanSlug(): string {
  const id = randomUUID().replace(/-/g, '').slice(0, 8);
  return `plan-${id}`;
}

/**
 * First markdown H1 in the spec/plan body; skips template placeholders and generic headings.
 */
export function extractPlanMarkdownTitle(markdown: string, fallback: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return fallback;
  const match = /^#\s+(.+?)\s*$/m.exec(trimmed);
  if (!match) return fallback;
  const candidate = match[1]
    .trim()
    .replace(/#+$/, '')
    .trim()
    .replace(/\{\{[^}]+\}\}/g, '')
    .trim();
  if (!candidate || isGenericPlanHeading(candidate)) return fallback;
  return candidate;
}

/** Kebab-case slug from a human title (not the full user prompt). */
export function slugFromPlanTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PLAN_SLUG_MAX_LEN)
    .replace(/-+$/g, '');
  return slug || 'plan';
}

export type PlanSlugExistsProbe = (planPath: string) => Promise<boolean>;

/**
 * Pick a unique top-level plan filename slug; appends -2, -3, … on collision.
 */
export async function ensureUniquePlanSlug(
  candidateTitle: string,
  excludePaths: string[] = [],
  probePlanExists: PlanSlugExistsProbe,
): Promise<string> {
  const base = slugFromPlanTitle(candidateTitle);
  const exclude = new Set(
    excludePaths.map((p) => p.trim().replace(/\\/g, '/')).filter(Boolean),
  );
  let slug = base;
  let suffix = 2;
  for (;;) {
    const planPath = superPlanPlanPath(slug);
    if (exclude.has(planPath)) return slug;
    const exists = await probePlanExists(planPath);
    if (!exists) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

export { superPlanPlanPath, superPlanResearchPath, superPlanSpecPath };
