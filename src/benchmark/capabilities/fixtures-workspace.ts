/**
 * Capability-matrix benchmark fixtures under ~/.minnow/benchmark-workspace/matrix/.
 * Stable paths and copy so probes never depend on the Minnow repo tree.
 */

import { executeBenchmarkTool } from '../execute-tool-sandbox.ts';
import {
  CAP_MATRIX_BUGGY_FN,
  CAP_MATRIX_BUGGY_PATH,
  CAP_MATRIX_GREP_TOKEN,
  CAP_MATRIX_HAYSTACK_LABEL,
  CAP_MATRIX_HAYSTACK_NEEDLE,
  CAP_MATRIX_HAYSTACK_PATH,
  CAP_MATRIX_JSON_KEY,
  CAP_MATRIX_JSON_PATH,
  CAP_MATRIX_NOTES_PATH,
  CAP_MATRIX_REPLACE_PATH,
  CAP_MATRIX_PDF_PATH,
  CAP_MATRIX_REPO_DIR,
  CAP_MATRIX_SAMPLE_FN,
  CAP_MATRIX_SAMPLE_PATH,
  CAPABILITY_MATRIX_FIXTURE_DIR,
} from './fixture-paths.ts';

export * from './fixture-paths.ts';

const NOTES_INITIAL = `- alpha item
- beta item
- gamma item
`;

/** Seeded only for `files-replace-text`; save/append probes use `notes.md` instead. */
const REPLACE_INITIAL = NOTES_INITIAL;

function buildSampleTs(): string {
  const lines = [
    '// Capability matrix fixture sample',
    `export function ${CAP_MATRIX_SAMPLE_FN}(): number {`,
    '  return 42;',
    '}',
  ];
  for (let line = 5; line <= 65; line += 1) {
    lines.push(`// padding line ${line}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Debug-mode fixture: the loop starts at 1 and silently drops the first value, so the
 * Debug probe has a real defect to find rather than a fabricated stack trace.
 */
function buildBuggyTs(): string {
  return [
    '// Capability matrix fixture with a seeded off-by-one.',
    `export function ${CAP_MATRIX_BUGGY_FN}(values: number[]): number {`,
    '  let total = 0;',
    '  for (let i = 1; i < values.length; i += 1) {',
    '    total += values[i];',
    '  }',
    '  return total;',
    '}',
    '',
  ].join('\n');
}

/**
 * Haystack fixture: the needle sits mid-file behind its label so a probe that only
 * reads the head (or the 32k `read_file` cap) cannot stumble onto it.
 */
function buildHaystackTxt(): string {
  const filler = 'filler '.repeat(80);
  const lines = Array.from({ length: 120 }, (_, i) => `line-${i + 1} ${filler}`);
  lines.splice(60, 0, `${CAP_MATRIX_HAYSTACK_LABEL}: ${CAP_MATRIX_HAYSTACK_NEEDLE}`);
  return `${lines.join('\n')}\n`;
}

/** Probe user messages live in `probe-prompts.ts` (no tool-sandbox import). */
export {
  CAPABILITY_PROBE_PROMPTS,
  getCapabilityProbePrompt,
} from './probe-prompts.ts';

/** Phase 2c capability ids (re-export for fixture helpers). */
export { PHASE_2C_WORKSPACE_CAPABILITY_IDS } from './probe-wave-ids.ts';
import { PHASE_2C_ID_SET } from './probe-wave-ids.ts';

export function isPhase2cWorkspaceCapabilityId(id: string): boolean {
  return PHASE_2C_ID_SET.has(id);
}

/** Remove prior matrix fixtures (idempotent). */
export async function cleanupCapabilityMatrixFixtures(workspaceRoot: string): Promise<void> {
  try {
    await executeBenchmarkTool(
      'delete_path',
      { path: CAPABILITY_MATRIX_FIXTURE_DIR },
      { workspaceRoot },
    );
  } catch {}
}

async function saveText(
  workspaceRoot: string,
  path: string,
  content: string,
): Promise<void> {
  await executeBenchmarkTool('save_file', { path, content }, { workspaceRoot });
}

async function runShell(
  workspaceRoot: string,
  command: string,
  cwd?: string,
): Promise<void> {
  const result = await executeBenchmarkTool(
    'execute_command',
    { command, cwd, timeout_ms: 120_000 },
    { workspaceRoot },
  );
  if (result.content.startsWith('Error:')) {
    throw new Error(result.content.slice(0, 240));
  }
}

async function seedGitFixture(workspaceRoot: string): Promise<void> {
  const readme = '# cap-matrix fixture repo\n';
  await saveText(workspaceRoot, `${CAP_MATRIX_REPO_DIR}/README.md`, readme);
  await saveText(workspaceRoot, '.gitignore', '.minnow/\n');
  await runShell(workspaceRoot, 'git init -b main');
  await runShell(workspaceRoot, 'git add -A');
  await runShell(
    workspaceRoot,
    'git -c user.email=bench@minnow.local -c user.name="Minnow Bench" commit -m "cap-matrix initial"',
  );
  await saveText(
    workspaceRoot,
    `${CAP_MATRIX_REPO_DIR}/README.md`,
    '# cap-matrix fixture repo\n\nuncommitted probe edit\n',
  );
}

/**
 * Seed matrix fixtures and throwaway git repo under the benchmark workspace.
 */
export async function seedCapabilityMatrixFixtures(workspaceRoot: string): Promise<void> {
  await cleanupCapabilityMatrixFixtures(workspaceRoot);

  await executeBenchmarkTool(
    'make_directory',
    { path: `${CAPABILITY_MATRIX_FIXTURE_DIR}/a/b` },
    { workspaceRoot },
  );

  const jsonBody = JSON.stringify({ capMatrixFixtureKey: CAP_MATRIX_JSON_KEY }, null, 2);
  await saveText(workspaceRoot, CAP_MATRIX_JSON_PATH, `${jsonBody}\n`);
  await saveText(workspaceRoot, CAP_MATRIX_NOTES_PATH, NOTES_INITIAL);
  await saveText(workspaceRoot, CAP_MATRIX_REPLACE_PATH, REPLACE_INITIAL);
  await saveText(workspaceRoot, CAP_MATRIX_SAMPLE_PATH, buildSampleTs());
  await saveText(workspaceRoot, CAP_MATRIX_BUGGY_PATH, buildBuggyTs());
  await saveText(
    workspaceRoot,
    CAP_MATRIX_HAYSTACK_PATH,
    `${buildHaystackTxt()}${CAP_MATRIX_GREP_TOKEN}\n`,
  );

  const pdfBody = `Capability matrix PDF fixture. Token: ${CAP_MATRIX_GREP_TOKEN}.`;
  const pdfResult = await executeBenchmarkTool(
    'create_pdf',
    { path: CAP_MATRIX_PDF_PATH, body: pdfBody, title: 'Cap matrix fixture' },
    { workspaceRoot },
  );
  if (pdfResult.content.startsWith('Error:')) {
    throw new Error(pdfResult.content.slice(0, 240));
  }

  await seedGitFixture(workspaceRoot);
}

/** True when the throwaway git repo has been initialized. */
export async function isCapabilityMatrixGitFixtureReady(workspaceRoot: string): Promise<boolean> {
  try {
    const result = await executeBenchmarkTool(
      'read_file',
      { path: '.git/HEAD' },
      { workspaceRoot },
    );
    return !result.content.startsWith('Error:') && result.content.includes('ref:');
  } catch {
    return false;
  }
}

/**
 * Clean + seed capability-matrix fixtures (call once per capability-matrix suite run).
 */
export async function ensureCapabilityMatrixFixturesReady(workspaceRoot: string): Promise<void> {
  await seedCapabilityMatrixFixtures(workspaceRoot);
}
