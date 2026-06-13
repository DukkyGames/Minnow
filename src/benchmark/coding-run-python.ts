/**
 * Run model-authored Python during benchmarks (via run_python tool).
 */

import { raceWithAbort } from './abort.ts';
import {
  parseRunJavascriptToolOutput,
  type ParsedRunJavascriptOutput,
} from './coding-code.ts';
import { executeBenchmarkTool } from './execute-tool-sandbox.ts';

export interface RunCodingPythonResult extends ParsedRunJavascriptOutput {
  code: string;
}

/** Execute a Python script with POST /api/tools (requires npm start). */
export async function runCodingPython(
  code: string,
  signal: AbortSignal,
): Promise<RunCodingPythonResult> {
  const tool = await raceWithAbort(signal, executeBenchmarkTool('run_python', { code }));
  const parsed = parseRunJavascriptToolOutput(tool.content);
  return { ...parsed, code };
}
