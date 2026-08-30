export function stripPromptFrontmatter(raw: string): string;

export function loadRolePrompt(
  role: 'builder' | 'tester' | 'final',
  variant?: 'full' | 'lite',
): Promise<string>;

export function interpolatePrompt(
  template: string,
  vars: Record<string, string>,
): string;
