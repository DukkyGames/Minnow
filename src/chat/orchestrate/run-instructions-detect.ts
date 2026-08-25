/**
 * Fallback run-command detection for the finish report.
 *
 * Only used when the final integration tester did not report `run_instructions`.
 * Everything here is inferred from manifests, never executed, so the caller
 * labels the block unverified — the old hardcoded `npm install && npm start`
 * claimed more than it knew, on every project regardless of language.
 */

import { readWorkspaceTextFile } from '../../attachments/workspace-text-read.ts';

export interface DetectedRunInstructions {
  install?: string;
  start?: string;
  test?: string;
  /** Manifest the commands were read from, named in the report. */
  source: string;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    const text = await readWorkspaceTextFile(path);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** First script name present in `scripts`, in preference order. */
function pickScript(
  scripts: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  for (const name of candidates) {
    if (typeof scripts[name] === 'string') return name;
  }
  return undefined;
}

function fromPackageJson(text: string): DetectedRunInstructions | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const scriptsRaw = (parsed as Record<string, unknown>).scripts;
  const scripts =
    scriptsRaw && typeof scriptsRaw === 'object'
      ? (scriptsRaw as Record<string, unknown>)
      : {};

  const start = pickScript(scripts, ['start', 'dev', 'serve']);
  const test = pickScript(scripts, ['test']);
  return {
    install: 'npm install',
    ...(start ? { start: start === 'start' ? 'npm start' : `npm run ${start}` } : {}),
    ...(test ? { test: 'npm test' } : {}),
    source: 'package.json',
  };
}

/** Manifests checked in order; the first that parses wins. */
const DETECTORS: Array<{
  path: string;
  parse: (text: string) => DetectedRunInstructions | null;
}> = [
  { path: 'package.json', parse: fromPackageJson },
  {
    path: 'Cargo.toml',
    parse: () => ({
      install: 'cargo build',
      start: 'cargo run',
      test: 'cargo test',
      source: 'Cargo.toml',
    }),
  },
  {
    path: 'pyproject.toml',
    parse: (text) => ({
      install: /\[tool\.poetry\]/.test(text) ? 'poetry install' : 'pip install -e .',
      ...(/\[tool\.pytest/.test(text) ? { test: 'pytest' } : {}),
      source: 'pyproject.toml',
    }),
  },
  {
    path: 'Makefile',
    parse: (text) => {
      const targets = new Set(
        [...text.matchAll(/^([A-Za-z0-9_.-]+):/gm)].map((m) => m[1]!),
      );
      if (!targets.size) return null;
      return {
        ...(targets.has('install') ? { install: 'make install' } : {}),
        ...(targets.has('run')
          ? { start: 'make run' }
          : targets.has('start')
            ? { start: 'make start' }
            : {}),
        ...(targets.has('test') ? { test: 'make test' } : {}),
        source: 'Makefile',
      };
    },
  },
];

/** Best-effort run commands inferred from the workspace's manifests. */
export async function detectProjectRunInstructions(): Promise<DetectedRunInstructions | null> {
  for (const detector of DETECTORS) {
    const text = await readIfPresent(detector.path);
    if (!text) continue;
    const detected = detector.parse(text);
    if (!detected) continue;
    if (!detected.install && !detected.start && !detected.test) continue;
    return detected;
  }
  return null;
}

/** Markdown for the finish report's "How to run" section, marked unverified. */
export function formatDetectedRunInstructions(
  detected: DetectedRunInstructions | null,
): string {
  if (!detected) {
    return '_No run commands detected. Check the project README._';
  }
  const commands = [detected.install, detected.start, detected.test].filter(
    (cmd): cmd is string => Boolean(cmd),
  );
  return [
    '```bash',
    ...commands,
    '```',
    '',
    `_Inferred from \`${detected.source}\` — not verified by running them._`,
  ].join('\n');
}
