/**
 * Server-side benchmark runner (child process) so runs survive browser reload.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMinnowLayout, getMinnowHome } from '../config/home.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function activeRunFilePath() {
  return path.join(getMinnowHome(), 'benchmarks', 'active-run.json');
}

/** @type {{
 *   status: 'idle' | 'running' | 'complete' | 'cancelled' | 'error';
 *   events: object[];
 *   config: object | null;
 *   run: object | null;
 *   error: string | null;
 *   child: import('node:child_process').ChildProcess | null;
 * } | null} */
let session = null;

async function persistSession() {
  if (!session) {
    try {
      await fs.unlink(activeRunFilePath());
    } catch {
      /* no file */
    }
    return;
  }

  await ensureMinnowLayout();
  const payload = {
    status: session.status,
    events: session.events,
    config: session.config,
    run: session.run,
    error: session.error,
  };
  await fs.writeFile(activeRunFilePath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function applyProgressEvent(event) {
  if (!session) return;
  session.events.push(event);
  if (event.type === 'run-done') {
    session.run = event.run;
    session.status = 'complete';
  }
  if (event.type === 'run-cancelled') {
    session.status = 'cancelled';
  }
}

function snapshot() {
  if (!session) {
    return { status: 'idle', events: [], config: null, run: null, error: null };
  }
  return {
    status: session.status,
    events: session.events,
    config: session.config,
    run: session.run,
    error: session.error,
  };
}

export function getActiveBenchmarkSnapshot() {
  return snapshot();
}

export async function loadPersistedActiveBenchmark() {
  try {
    const raw = await fs.readFile(activeRunFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.status === 'running') {
      parsed.status = 'error';
      parsed.error = 'Benchmark was interrupted when the server restarted.';
      await fs.writeFile(activeRunFilePath(), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    }
    session = {
      status: parsed.status ?? 'idle',
      events: Array.isArray(parsed.events) ? parsed.events : [],
      config: parsed.config ?? null,
      run: parsed.run ?? null,
      error: parsed.error ?? null,
      child: null,
    };
  } catch {
    session = null;
  }
}

export async function startActiveBenchmarkRun(config) {
  await abortActiveBenchmarkRun({ clear: true });

  session = {
    status: 'running',
    events: [],
    config,
    run: null,
    error: null,
    child: null,
  };
  await persistSession();

  const configPath = path.join(
    os.tmpdir(),
    `minnow-benchmark-${Date.now()}.json`,
  );
  await fs.writeFile(configPath, JSON.stringify(config), 'utf8');

  const tsxCli = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const worker = path.join(PROJECT_ROOT, 'scripts', 'benchmark-run-worker.mts');
  const child = spawn(process.execPath, [tsxCli, worker, configPath], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  session.child = child;
  let stdoutBuf = '';

  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        applyProgressEvent(event);
        void persistSession();
      } catch {
        /* ignore malformed line */
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text && session?.status === 'running') {
      session.error = text;
    }
  });

  child.on('close', (code) => {
    if (!session) return;
    session.child = null;
    if (session.status === 'running') {
      session.status = code === 0 ? 'complete' : 'error';
      if (code !== 0 && !session.error) {
        session.error = `Benchmark worker exited with code ${code ?? 'unknown'}`;
      }
    }
    void persistSession();
  });

  return snapshot();
}

export async function abortActiveBenchmarkRun(options = {}) {
  if (!session) return snapshot();
  if (session.child && !session.child.killed) {
    session.child.kill('SIGTERM');
  }
  if (session.status === 'running') {
    session.status = 'cancelled';
    session.events.push({ type: 'run-cancelled' });
  }
  session.child = null;
  if (options.clear) {
    session = null;
    try {
      await fs.unlink(activeRunFilePath());
    } catch {
      /* ignore */
    }
    return snapshot();
  }
  await persistSession();
  return snapshot();
}
