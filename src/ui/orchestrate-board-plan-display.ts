/** Basename for the init banner (plan path from the select). */
export function formatBoardOnboardingPlanDisplay(planPath: string): string {
  const trimmed = planPath.trim();
  if (!trimmed) return 'Plan file';
  const parts = trimmed.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? trimmed;
}
