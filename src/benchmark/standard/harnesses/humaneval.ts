/**
 * HumanEval Python harness — assemble program and execute check(candidate) via run_python.
 */

import { runCodingPython } from '../../coding-run-python.ts';
import { extractCodeBlock } from '../scorers.ts';
import type { StandardBenchmarkItem } from '../types.ts';
import type { StandardScoreResult } from './types.ts';

/** Trailing instruction appended to HumanEval prompts in bundled packs. */
export const HUMANEVAL_PROMPT_SUFFIX =
  '\nComplete the Python function. Reply with a fenced ```python code block only.';

/** Re-indent a body-only completion to sit inside the function stub (4 spaces). */
export function normalizeBodyIndent(completion: string, baseIndent = 4): string {
  const lines = completion.split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  if (indents.length === 0) return completion;

  const minIndent = Math.min(...indents);

  return lines
    .map((line) => {
      if (!line.trim()) return '';
      const ws = line.match(/^\s*/)?.[0].length ?? 0;
      // HumanEval canonical bodies often mix column-0 and 4-space sibling lines with 8+ nested lines.
      const physical =
        minIndent === 0 && ws <= 4
          ? baseIndent
          : baseIndent + (ws - Math.max(minIndent, 4));
      return ' '.repeat(physical) + line.trimStart();
    })
    .join('\n');
}

export interface HumanEvalHarnessOptions {
  item: StandardBenchmarkItem;
  response: string;
  signal: AbortSignal;
  runPython?: typeof runCodingPython;
}

/** Strip the completion instruction suffix to recover the function stub prefix. */
export function derivePromptPrefix(prompt: string): string {
  if (prompt.endsWith(HUMANEVAL_PROMPT_SUFFIX)) {
    return prompt.slice(0, -HUMANEVAL_PROMPT_SUFFIX.length);
  }
  const alt = prompt.match(/^([\s\S]*?)\nComplete the Python function\./);
  return alt?.[1] ?? prompt;
}

/** Build the full Python program: stub + completion + official check() harness. */
export function assembleHumanEvalProgram(
  item: StandardBenchmarkItem,
  completion: string,
): { program: string } | { error: string } {
  const entryPoint = item.metadata?.entryPoint?.trim();
  const tests = item.metadata?.tests?.trim();
  if (!entryPoint || !tests) {
    return { error: 'HumanEval item missing metadata.entryPoint or metadata.tests' };
  }

  const trimmed = completion.trim();
  if (!trimmed) {
    return { error: 'No Python completion in response' };
  }

  const defPattern = new RegExp(`\\bdef\\s+${entryPoint}\\b`);
  const body = defPattern.test(trimmed)
    ? trimmed
    : `${derivePromptPrefix(item.prompt)}${normalizeBodyIndent(trimmed)}`;

  const program = `${body}\n\n${tests}\ncheck(${entryPoint})`;
  return { program };
}

/** Score a HumanEval item by running the official unit-test harness. */
export async function scoreHumanEval(options: HumanEvalHarnessOptions): Promise<StandardScoreResult> {
  const { item, response, signal, runPython = runCodingPython } = options;
  const completion = extractCodeBlock(response);
  const assembled = assembleHumanEvalProgram(item, completion);

  if ('error' in assembled) {
    return { passed: false, score: 0, details: assembled.error };
  }

  try {
    const exec = await runPython(assembled.program, signal);
    if (exec.ok) {
      return { passed: true, score: 1 };
    }

    const stderr = exec.stderr.trim().slice(0, 200);
    const hint = stderr || exec.raw.slice(0, 200);
    if (exec.timedOut) {
      return { passed: false, score: 0, details: `HumanEval harness timed out: ${hint}` };
    }
    return {
      passed: false,
      score: 0,
      details: `HumanEval check() failed (exit ${exec.exitCode ?? '?'}): ${hint}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/fetch|network|failed|ECONNREFUSED/i.test(message)) {
      return {
        passed: false,
        score: 0,
        details: 'HumanEval harness requires tool server and Python (npm start)',
      };
    }
    return { passed: false, score: 0, details: message };
  }
}
