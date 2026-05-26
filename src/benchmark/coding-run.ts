/**
 * Run model-authored JavaScript during coding benchmarks (via run_javascript tool).
 */

import { executeTool } from '../tools/client.ts';
import { raceWithAbort } from './abort.ts';
import {
  extractJavaScriptFromModelText,
  parseRunJavascriptToolOutput,
  type ParsedRunJavascriptOutput,
} from './coding-code.ts';

export interface RunCodingJavaScriptResult extends ParsedRunJavascriptOutput {
  code: string;
}

/** Extract and execute JavaScript from a model reply using the local tool server. */
export async function runCodingJavaScriptFromModelText(
  modelText: string,
  signal: AbortSignal,
): Promise<
  | { ok: true; result: RunCodingJavaScriptResult }
  | { ok: false; reason: string; result?: RunCodingJavaScriptResult }
> {
  const code = extractJavaScriptFromModelText(modelText);
  if (!code) {
    return { ok: false, reason: 'no JavaScript code block in response' };
  }

  const exec = await runCodingJavaScript(code, signal);
  if (!exec.ok) {
    const hint = exec.stderr.trim() || exec.raw.slice(0, 160);
    return {
      ok: false,
      reason: exec.timedOut ? 'script timed out' : `run failed (exit ${exec.exitCode ?? '?'})`,
      result: { ...exec, code },
    };
  }

  return { ok: true, result: { ...exec, code } };
}

/** Execute a script with Node via POST /api/tools (requires npm start). */
export async function runCodingJavaScript(
  code: string,
  signal: AbortSignal,
): Promise<RunCodingJavaScriptResult> {
  const tool = await raceWithAbort(
    signal,
    executeTool('run_javascript', { code }),
  );
  const parsed = parseRunJavascriptToolOutput(tool.content);
  return { ...parsed, code };
}

export function codingRunDetails(
  modelText: string,
  run: RunCodingJavaScriptResult | undefined,
  passed: boolean,
): string {
  if (!run) return modelText.slice(0, 120);
  const out = run.stdout.trim().slice(0, 120);
  if (passed) return out || '(empty stdout)';
  if (!run.ok) return run.stderr.trim().slice(0, 120) || run.raw.slice(0, 120);
  return out || run.raw.slice(0, 120);
}
