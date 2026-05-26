/**
 * Extract JavaScript from model replies and parse run_javascript tool output.
 */

/** Appended to runnable coding prompts so models emit an executable script. */
export const CODING_JAVASCRIPT_PROMPT_SUFFIX =
  '\n\nWrite a complete Node.js script that solves the task. ' +
  'Output only one ```javascript fenced code block. ' +
  'Use console.log to print the answer on stdout (one line when possible). ' +
  'No text outside the fence.';

const FENCE_RE = /```(?:javascript|js)?\s*\n?([\s\S]*?)```/i;

/** Pull the first fenced JavaScript block, or the whole reply if it looks like code. */
export function extractJavaScriptFromModelText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fence = FENCE_RE.exec(trimmed);
  if (fence?.[1]) {
    const block = fence[1].trim();
    return block.length > 0 ? block : null;
  }

  if (looksLikeJavaScriptSource(trimmed)) {
    return trimmed;
  }

  return null;
}

function looksLikeJavaScriptSource(text: string): boolean {
  if (text.includes('```')) return false;
  return (
    /\bconsole\.log\s*\(/.test(text) ||
    /\bfunction\s+\w+/.test(text) ||
    /^\s*(const|let|var)\s+/m.test(text)
  );
}

export interface ParsedRunJavascriptOutput {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  raw: string;
}

/** Parse formatted output from the run_javascript / node -e tool. */
export function parseRunJavascriptToolOutput(content: string): ParsedRunJavascriptOutput {
  const raw = content;
  if (content.startsWith('Error:')) {
    return { ok: false, stdout: '', stderr: content, exitCode: null, timedOut: false, raw };
  }

  const timedOut = /\(timed out after/i.test(content);
  const exitMatch = content.match(/\(exit (\d+)\)/);
  const exitCode = exitMatch ? Number.parseInt(exitMatch[1]!, 10) : null;

  const stdout = extractLabeledSection(content, 'stdout');
  const stderr = extractLabeledSection(content, 'stderr');

  const ok = !timedOut && exitCode === 0;
  return { ok, stdout, stderr, exitCode, timedOut, raw };
}

function extractLabeledSection(content: string, label: 'stdout' | 'stderr'): string {
  const marker = `${label}:\n`;
  const start = content.indexOf(marker);
  if (start < 0) return '';

  const bodyStart = start + marker.length;
  const nextStdout = content.indexOf('\n\nstdout:\n', bodyStart);
  const nextStderr = content.indexOf('\n\nstderr:\n', bodyStart);
  let end = content.length;
  if (label === 'stdout' && nextStderr >= 0) end = Math.min(end, nextStderr);
  if (label === 'stderr' && nextStdout >= bodyStart) end = Math.min(end, nextStdout);

  return content.slice(bodyStart, end).trimEnd();
}

/** Fifteen comma-separated FizzBuzz tokens from 1 through FizzBuzz. */
export function fizzBuzzLinePasses(text: string): boolean {
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 15 || parts[0] !== '1') return false;
  if (parts[14]?.toLowerCase() !== 'fizzbuzz') return false;
  return /fizz/i.test(text) && /buzz/i.test(text);
}

export function jsonStdoutPasses(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return Object.prototype.hasOwnProperty.call(parsed, 'a') &&
      Object.prototype.hasOwnProperty.call(parsed, 'b');
  } catch {
    return false;
  }
}
