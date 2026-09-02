export const CONTEXT_OVERFLOW_MARKERS = [
  'exceeds the available context size',
  'exceeds the context size',
  'try increasing it',
  'context length exceeded',
  'context_length_exceeded',
  'maximum context length',
  'reduce the length of the messages',
  'prompt is too long',
  'exceed context limit',
  'exceeds max context window',
  'prompt too long',
  'context limit has been reached',
  'exceed context window',
  'requested tokens',
];

export function isContextOverflowText(text) {
  const lower = String(text ?? '').toLowerCase();
  return CONTEXT_OVERFLOW_MARKERS.some((marker) => lower.includes(marker));
}

/** `request (104264 tokens) exceeds the available context size (89088 tokens)` */
const LLAMA_CPP_NUMBERS =
  /request\s*\(\s*(\d+)\s*tokens?\s*\)[^()]*\(\s*(\d+)\s*tokens?\s*\)/i;

export function parseContextOverflowNumbers(text) {
  const match = LLAMA_CPP_NUMBERS.exec(String(text ?? ''));
  if (!match) return null;
  const requestTokens = Number(match[1]);
  const limitTokens = Number(match[2]);
  if (!Number.isFinite(requestTokens) || !Number.isFinite(limitTokens)) return null;
  if (requestTokens <= 0 || limitTokens <= 0) return null;
  if (requestTokens <= limitTokens) return null;
  return { requestTokens, limitTokens };
}

export function contextRetryMessageLimit(sentEstimate, numbers, safetyMargin) {
  if (sentEstimate <= 0) return 1;
  const shrink = numbers
    ? (numbers.limitTokens * safetyMargin) / numbers.requestTokens
    : safetyMargin * safetyMargin;
  return Math.max(1, Math.floor(sentEstimate * shrink));
}
