/**
 * Capability-matrix benchmark fixtures under ~/.minnow/benchmark-workspace/matrix/.
 * Stable paths and copy so probes never depend on the Minnow repo tree.
 */

import { executeBenchmarkTool } from '../execute-tool-sandbox.ts';

/** Root folder for all capability-matrix fixtures (relative to benchmark workspace). */
export const CAPABILITY_MATRIX_FIXTURE_DIR = 'matrix';

export const CAP_MATRIX_NOTES_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/notes.md`;
export const CAP_MATRIX_SAMPLE_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/sample.ts`;
export const CAP_MATRIX_HAYSTACK_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/haystack.txt`;
export const CAP_MATRIX_JSON_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/a/b/c.json`;
export const CAP_MATRIX_PDF_PATH = `${CAPABILITY_MATRIX_FIXTURE_DIR}/fixture.pdf`;
export const CAP_MATRIX_REPO_DIR = `${CAPABILITY_MATRIX_FIXTURE_DIR}/repo`;

/** Grep probe token — only present in seeded fixture files. */
export const CAP_MATRIX_GREP_TOKEN = 'cap-matrix-grep-token-42';

/** JSON value probes can ask the model to read back. */
export const CAP_MATRIX_JSON_KEY = 'bench-alpha-7';

/** Symbol name in sample.ts for code-intel probes. */
export const CAP_MATRIX_SAMPLE_FN = 'capMatrixSampleFn';

/** Long-context needle (core-long-context when enabled). */
export const CAP_MATRIX_HAYSTACK_NEEDLE = 'needle-marker-cap-matrix';

const NOTES_INITIAL = `- alpha item
- beta item
- gamma item
`;

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

function buildHaystackTxt(): string {
  const head = `${CAP_MATRIX_HAYSTACK_NEEDLE}\n`;
  const filler = 'filler '.repeat(80);
  const body = Array.from({ length: 120 }, (_, i) => `line-${i + 1} ${filler}`).join('\n');
  return `${head}${body}\n`;
}

/** User messages for phase-2c workspace probes (override spreadsheet drift). */
export const CAPABILITY_FIXTURE_PROBE_PROMPTS: Record<string, string> = {
  'files-list-read': `List the files in ${CAPABILITY_MATRIX_FIXTURE_DIR} and read ${CAP_MATRIX_JSON_PATH}.`,
  'files-read-document': `Use read_document on ${CAP_MATRIX_PDF_PATH} and summarize the body in one sentence.`,
  'files-save-append': `Create ${CAP_MATRIX_NOTES_PATH} with three markdown bullets (- one, - two, - three), then append a fourth bullet (- four).`,
  'files-replace-text': `In ${CAP_MATRIX_NOTES_PATH}, replace the exact line "- beta item" with "- BETA item" using replace_text_in_file.`,
  'files-insert-range': `Read lines 40-60 of ${CAP_MATRIX_SAMPLE_PATH}, then insert "// cap-matrix probe" at line 41.`,
  'files-grep': `Find every file under ${CAPABILITY_MATRIX_FIXTURE_DIR} that mentions ${CAP_MATRIX_GREP_TOKEN}.`,
  'docs-create-office': `Create a spreadsheet at ${CAPABILITY_MATRIX_FIXTURE_DIR}/commits.xlsx listing the last 3 commits (sha and message) from ${CAP_MATRIX_REPO_DIR}.`,
  'git-read': `In ${CAP_MATRIX_REPO_DIR}, what has changed on the current branch?`,
  'git-write': `Commit the current changes in ${CAP_MATRIX_REPO_DIR} on a new branch named cap-matrix-probe.`,
  'code-execute-command': 'Run `node -e "console.log(9*7)"` and report the printed number.',
  'code-background-cmds':
    'Start `node -e "setInterval(()=>console.log(\'cap-matrix-heartbeat\'),400)"` in the background, confirm cap-matrix-heartbeat appears in the log, then stop the run.',
  'code-run-js-py':
    'Use run_python to compute the mean of: 12, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33.',
  'code-command-log':
    'Start a background node process that prints cap-matrix-log-line every 300ms, read its command log, then stop it.',
  'code-repo-intel': `In ${CAP_MATRIX_SAMPLE_PATH}, where is ${CAP_MATRIX_SAMPLE_FN} defined and who calls it?`,
};

/** Phase 2e probes that use matrix fixture paths in user messages. */
export const PHASE_2E_FIXTURE_PROBE_PROMPTS: Record<string, string> = {
  'core-parallel-tools': `Read these three files in one turn if your host allows parallel tool calls: ${CAP_MATRIX_JSON_PATH}, ${CAP_MATRIX_NOTES_PATH}, and ${CAP_MATRIX_SAMPLE_PATH}.`,
  'core-tool-loop': `In ${CAP_MATRIX_REPO_DIR}, list changed files, read the diff for the first changed file, then summarize the change in one sentence.`,
  'core-long-context': `The needle ${CAP_MATRIX_HAYSTACK_NEEDLE} appears at the start of ${CAP_MATRIX_HAYSTACK_PATH}. What is the needle string?`,
  'lsp-diagnostics': `Call list_lsp_servers, then get_lsp_diagnostics for ${CAP_MATRIX_SAMPLE_PATH} if a TypeScript server is available.`,
};

export function getCapabilityFixtureProbePrompt(capabilityId: string): string | undefined {
  return (
    CAPABILITY_FIXTURE_PROBE_PROMPTS[capabilityId] ??
    PHASE_2E_FIXTURE_PROBE_PROMPTS[capabilityId]
  );
}

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
  } catch {
    /* missing dir */
  }
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
  await runShell(workspaceRoot, 'git init -b main', CAP_MATRIX_REPO_DIR);
  await runShell(workspaceRoot, 'git add -A', CAP_MATRIX_REPO_DIR);
  await runShell(
    workspaceRoot,
    'git -c user.email=bench@minnow.local -c user.name="Minnow Bench" commit -m "cap-matrix initial"',
    CAP_MATRIX_REPO_DIR,
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
  await saveText(workspaceRoot, CAP_MATRIX_SAMPLE_PATH, buildSampleTs());
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
      { path: `${CAP_MATRIX_REPO_DIR}/.git/HEAD` },
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
