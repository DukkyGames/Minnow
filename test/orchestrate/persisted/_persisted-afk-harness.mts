import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Window } from 'happy-dom';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

export type ApiResult<T = Record<string, unknown>> = {
  status: number;
  body: T;
  text: string;
};

export type RestartCheckpoint =
  | 'after-server-ready'
  | 'after-fake-model-start'
  | 'after-board-seed'
  | 'after-worktree-create'
  | 'after_board_start';

export type SeedBoardOptions = {
  preset?: 'quick' | 'smoke';
  stableIds?: boolean;
};

export class PersistedAfkHarness {
  readonly root: string;
  readonly home: string;
  readonly workspace: string;
  readonly port: number;
  readonly baseUrl: string;

  private child: ChildProcessWithoutNullStreams | null = null;
  private token = '';
  private output = '';

  private constructor(root: string, port: number) {
    this.root = root;
    this.home = path.join(root, 'home');
    this.workspace = path.join(root, 'workspace');
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
  }

  static async create(): Promise<PersistedAfkHarness> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-persisted-afk-'));
    const port = await reservePort();
    const harness = new PersistedAfkHarness(root, port);
    await fs.mkdir(harness.home, { recursive: true });
    await fs.mkdir(harness.workspace, { recursive: true });
    await harness.initGitRepository();
    await fs.writeFile(
      path.join(harness.home, 'config.json'),
      `${JSON.stringify({ workspace: { path: harness.workspace } }, null, 2)}\n`,
      'utf8',
    );
    return harness;
  }

  get serverOutput(): string {
    return this.output;
  }

  get authToken(): string {
    if (!this.token) throw new Error('server session token is not available');
    return this.token;
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('server is already running');
    this.output = '';
    const child = spawn(process.execPath, ['server.js'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BROWSER: 'none',
        MINNOW_HEADLESS: '1',
        MINNOW_HOME: this.home,
        MINNOW_TEST: '1',
        PORT: String(this.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    const capture = (chunk: Buffer): void => {
      this.output += chunk.toString('utf8');
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    await this.waitUntilReady();
  }

  async restart(checkpoint: RestartCheckpoint): Promise<void> {
    await this.stopServer();
    await this.start();
    const ping = await this.api('GET', '/api/config/ping');
    if (ping.status !== 200) {
      throw new Error(`restart at ${checkpoint} did not restore config API: ${ping.text}`);
    }
  }

  async stopServer(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.token = '';
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`server did not stop\n${this.output}`)), 10_000),
      ),
    ]);
  }

  async dispose(): Promise<void> {
    await this.stopServer();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rm(this.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        return;
      } catch (error) {
        if (attempt === 4) throw error;
        await delay(100 * (attempt + 1));
      }
    }
  }

  async api<T = Record<string, unknown>>(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        'X-Minnow-Token': this.authToken,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // Preserve non-JSON error bodies for diagnostics.
    }
    return { status: response.status, body: parsed as T, text };
  }

  async startFakeModel(): Promise<{ baseUrl: string }> {
    const result = await this.api<{ fakeModel?: { baseUrl?: string } }>(
      'POST',
      '/api/orchestrate/board-testing/fake-model/start',
      { port: 0 },
    );
    const baseUrl = result.body.fakeModel?.baseUrl;
    if (result.status !== 200 || !baseUrl) {
      throw new Error(`fake model failed to start: ${result.text}`);
    }
    return { baseUrl };
  }

  async configureFakeModel(scenario: { steps: unknown[] }): Promise<void> {
    const result = await this.api(
      'POST',
      '/api/orchestrate/board-testing/fake-model/scenario',
      scenario,
    );
    if (result.status !== 200) {
      throw new Error(`fake model scenario failed to configure: ${result.text}`);
    }
  }

  async seedAfkBoard(options: SeedBoardOptions = {}): Promise<{ groupId: string; plannerId: string }> {
    const seeded = await this.api<{ groupId?: string; plannerId?: string }>(
      'POST',
      '/api/orchestrate/board-testing/seed',
      {
        workspacePath: this.workspace,
        preset: options.preset ?? 'quick',
        mode: 'afk',
        stableIds: options.stableIds ?? true,
        providerId: 'fake-board',
        modelId: 'fake-board-model',
      },
    );
    if (seeded.status !== 200 || !seeded.body.groupId || !seeded.body.plannerId) {
      throw new Error(`board seed failed: ${seeded.text}`);
    }
    return { groupId: seeded.body.groupId, plannerId: seeded.body.plannerId };
  }

  private async initGitRepository(): Promise<void> {
    await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: this.workspace });
    await execFileAsync('git', ['config', 'user.name', 'Minnow Persisted Test'], {
      cwd: this.workspace,
    });
    await execFileAsync('git', ['config', 'user.email', 'persisted-test@minnow.local'], {
      cwd: this.workspace,
    });
    await fs.writeFile(path.join(this.workspace, 'README.md'), '# persisted AFK fixture\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: this.workspace });
    await execFileAsync('git', ['commit', '-m', 'initial fixture'], { cwd: this.workspace });
  }

  private async waitUntilReady(): Promise<void> {
    // Full-suite runs spawn many workers; allow extra headroom for cold server.js boot.
    const deadline = Date.now() + 60_000;
    const tokenPath = path.join(this.home, 'session-token');
    while (Date.now() < deadline) {
      if (this.child?.exitCode !== null) {
        throw new Error(`server exited during startup\n${this.output}`);
      }
      try {
        this.token = (await fs.readFile(tokenPath, 'utf8')).trim();
        if (this.token) {
          const response = await fetch(`${this.baseUrl}/api/config/ping`, {
            headers: { 'X-Minnow-Token': this.token },
          });
          if (response.ok) return;
          this.output += `\n[harness] readiness HTTP ${response.status}: ${await response.text()}\n`;
        }
      } catch {
        // Server and token file are not ready yet.
      }
      await delay(100);
    }
    throw new Error(`server readiness timed out\n${this.output}`);
  }
}

export function installPersistedClientDom(): () => void {
  const window = new Window({ url: 'http://127.0.0.1/' });
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.localStorage = window.localStorage;
  globalThis.performance = window.performance;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

  for (const [tag, id, value] of [
    ['select', 'modelSelect', 'fake-board-model'],
    ['input', 'temperature', '0.7'],
    ['input', 'maxTokens', '512'],
    ['textarea', 'systemPrompt', ''],
  ] as const) {
    const element = document.createElement(tag);
    element.id = id;
    if (element instanceof window.HTMLSelectElement) {
      const option = document.createElement('option');
      option.value = value;
      element.append(option);
    }
    element.value = value;
    document.body.append(element);
  }
  for (const id of ['chatArea', 'chatList', 'sDot', 'sText']) {
    const element = document.createElement(id.startsWith('s') ? 'span' : 'div');
    element.id = id;
    document.body.append(element);
  }

  return () => window.close();
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  if (!port) throw new Error('failed to reserve an ephemeral port');
  return port;
}
