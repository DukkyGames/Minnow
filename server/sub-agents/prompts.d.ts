export function loadSubAgentSystemPrompt(
  typeId: string,
  typeRow: Record<string, unknown>,
  task: string,
  profile?: 'full' | 'lite',
): Promise<string>;
