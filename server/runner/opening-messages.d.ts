export function buildOpeningMessages(
  systemPrompt: string,
  seed: string,
  prior?: unknown[],
): unknown[];

export function buildOpeningTranscript(
  systemPrompt: string,
  seed: string,
  prior?: unknown[],
): { messages: unknown[]; persistFrom: number };
