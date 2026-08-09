/**
 * Workspace-relative Super Plan artifact paths (shared by state + slug helpers).
 */

import { ORCHESTRATE_PLANS_PREFIX } from '../orchestrate/plan-path';

const REFERENCES_PREFIX = `${ORCHESTRATE_PLANS_PREFIX}references/`;

export function superPlanSpecPath(slug: string): string {
  return `${REFERENCES_PREFIX}${slug}-spec.md`;
}

export function superPlanResearchPath(slug: string): string {
  return `${REFERENCES_PREFIX}${slug}-research.md`;
}

export function superPlanPlanPath(slug: string): string {
  return `${ORCHESTRATE_PLANS_PREFIX}${slug}.md`;
}
