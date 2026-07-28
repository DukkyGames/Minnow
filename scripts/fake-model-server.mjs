#!/usr/bin/env node
/**
 * Local OpenAI-v1 fake model server for orchestrate board manual runs and tests.
 *
 * Usage:
 *   node scripts/fake-model-server.mjs [--port N] [--scenario path.json] [--register]
 *
 * Scenario JSON: ordered list of { match: { role?, taskId?, nth? }, emit: [...sse chunks] }.
 * The first matching step wins; omitted match fields are wildcards.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** @typedef {{ role?: string; taskId?: string; nth?: number }} ScenarioMatch */
/** @typedef {{ match?: ScenarioMatch; emit: string[] }} ScenarioStep */

export const FAKE_MODEL_ID = 'fake-board-model';
export const FAKE_PROVIDER_ID = 'fake-board';
const DEFAULT_PORT = 18765;

/** Every HTTP request recorded for assertions (method, url, body, parsed context). */
export const requests = [];

/** @type {Map<string, number>} */
const matchOccurrenceCounts = new Map();

/**
 * Build SSE chunks that stream a single board_report pass tool call.
 * @param {string} [taskId]
 * @param {string} [toolCallId]
 * @returns {string[]}
 */
export function boardReportPassChunks(taskId = 'W1-A', toolCallId = 'call_fake_board_report') {
  const args = JSON.stringify({
    task_id: taskId,
    outcome: 'pass',
    summary: 'Fake model server: board_report pass',
  });
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: 'function',
              function: { name: 'board_report', arguments: args },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    'event: end\ndata: {"status":"complete"}\n\n',
  ];
}

/** Prose completion — required after a tool-call round so runChatTurn can finish. */
export function proseSseChunks(text = 'Done.', finishReason = 'stop') {
  const delta = JSON.stringify({
    choices: [{ delta: { content: text } }],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: finishReason }],
  });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    'event: end\ndata: {"status":"complete"}\n\n',
  ];
}

/** Tester chat: VERDICT marker the board finalizer parses. */
export function testerVerdictChunks(verdict = 'pass') {
  return proseSseChunks(`VERDICT: ${verdict}`);
}

/**
 * Default board scenario: smart per-role / per-nth responses (no static wildcard).
 * Custom --scenario JSON can still override with explicit match steps.
 */
export const DEFAULT_SCENARIO = [];

/**
 * Built-in responses when no explicit scenario step matches.
 * @param {{ role?: string; taskId?: string }} ctx
 * @param {number} nth 0-based per (role, taskId) chat turn sequence
 * @returns {string[]}
 */
export function defaultEmitForContext(ctx, nth) {
  const taskId = ctx.taskId?.trim() || 'W1-A';

  if (ctx.role === 'tester') {
    return testerVerdictChunks('pass');
  }
  if (ctx.role === 'fixer') {
    return proseSseChunks(
      nth === 0 ? 'Resolved conflict with git commit --no-edit.' : 'Done.',
    );
  }
  if (ctx.role === 'final') {
    if (nth === 0) {
      return boardReportPassChunks('FULL_BOARD', 'call_fake_final_report');
    }
    return proseSseChunks('Done.');
  }
  if (ctx.role === 'builder') {
    if (nth === 0) {
      return boardReportPassChunks(taskId, `call_build_${taskId.replace(/[^A-Za-z0-9]/g, '_')}`);
    }
    return proseSseChunks('Done.');
  }

  return proseSseChunks('Done.');
}

/**
 * @param {unknown} raw
 * @returns {ScenarioStep[]}
 */
export function normalizeScenario(raw) {
  if (Array.isArray(raw)) {
    return raw.map(normalizeScenarioStep);
  }
  if (raw && typeof raw === 'object' && Array.isArray(/** @type {{ steps?: unknown }} */ (raw).steps)) {
    return /** @type {ScenarioStep[]} */ (raw.steps).map(normalizeScenarioStep);
  }
  throw new Error('Scenario JSON must be an array or { "steps": [...] }');
}

/**
 * @param {unknown} step
 * @returns {ScenarioStep}
 */
function normalizeScenarioStep(step) {
  if (!step || typeof step !== 'object' || !Array.isArray(/** @type {{ emit?: unknown }} */ (step).emit)) {
    throw new Error('Each scenario step requires an "emit" string array');
  }
  const emit = /** @type {string[]} */ (step.emit);
  const match = /** @type {{ match?: ScenarioMatch }} */ (step).match ?? {};
  return { match, emit };
}

/**
 * @param {string | undefined} scenarioPath
 * @returns {Promise<ScenarioStep[]>}
 */
export async function loadScenario(scenarioPath) {
  if (!scenarioPath) return DEFAULT_SCENARIO;
  const text = await readFile(scenarioPath, 'utf8');
  return normalizeScenario(JSON.parse(text));
}

/**
 * Flatten OpenAI-style messages to searchable text.
 * @param {unknown} body
 * @returns {string}
 */
function messagesText(body) {
  const messages = body && typeof body === 'object' ? /** @type {{ messages?: unknown }} */ (body).messages : null;
  if (!Array.isArray(messages)) return '';
  return messages
    .map((msg) => {
      if (!msg || typeof msg !== 'object') return '';
      const content = /** @type {{ content?: unknown; role?: string }} */ (msg).content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((part) =>
            part && typeof part === 'object' && typeof /** @type {{ text?: string }} */ (part).text === 'string'
              ? part.text
              : '',
          )
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

/**
 * Infer orchestrate role + task id from a chat-completions body.
 * @param {unknown} body
 * @returns {{ role?: string; taskId?: string }}
 */
export function extractRequestContext(body) {
  const text = messagesText(body);
  /** @type {{ role?: string; taskId?: string }} */
  const ctx = {};

  if (/Run per-task testing/i.test(text)) {
    ctx.role = 'tester';
  } else if (/merge conflict|merge-fixer|Re-commit the merge/i.test(text)) {
    ctx.role = 'fixer';
  } else if (/final full-board integration/i.test(text)) {
    ctx.role = 'final';
  } else if (/Execute this orchestrate task|Fix this orchestrate task/i.test(text)) {
    ctx.role = 'builder';
  }

  const taskLine = text.match(/Task:\s+([A-Z0-9_-]+)\s+—/);
  if (taskLine) {
    ctx.taskId = taskLine[1];
  } else {
    const taskIdArg = text.match(/task_id:\s*"([^"]+)"/);
    if (taskIdArg) ctx.taskId = taskIdArg[1];
  }

  return ctx;
}

/**
 * @param {ScenarioMatch} partial
 * @returns {string}
 */
function partialMatchKey(partial) {
  return `${partial.role ?? '*'}:${partial.taskId ?? '*'}`;
}

/**
 * Pick scenario emit chunks for this completion request.
 * @param {ScenarioStep[]} scenario
 * @param {{ role?: string; taskId?: string }} ctx
 * @returns {string[]}
 */
export function pickScenarioEmit(scenario, ctx) {
  const partial = { role: ctx.role, taskId: ctx.taskId };
  const key = partialMatchKey(partial);
  const nth = matchOccurrenceCounts.get(key) ?? 0;
  matchOccurrenceCounts.set(key, nth + 1);

  for (const step of scenario) {
    const match = step.match ?? {};
    if (match.role !== undefined && match.role !== ctx.role) continue;
    if (match.taskId !== undefined && match.taskId !== ctx.taskId) continue;
    if (match.nth !== undefined && match.nth !== nth) continue;
    return step.emit;
  }

  return defaultEmitForContext(ctx, nth);
}

/**
 * @param {{ scenario?: ScenarioStep[]; port?: number; host?: string }} [opts]
 */
export function createFakeModelServer(opts = {}) {
  const scenario = opts.scenario ?? DEFAULT_SCENARIO;
  const host = opts.host ?? '127.0.0.1';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/v1/models') {
      const entry = {
        at: Date.now(),
        method: req.method,
        url: req.url,
        pathname,
        body: null,
        context: null,
      };
      requests.push(entry);
      console.error(`[fake-model] GET ${pathname} (#${requests.length})`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: FAKE_MODEL_ID, object: 'model', owned_by: 'fake-model-server' }],
        }),
      );
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        /** @type {unknown} */
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = { parseError: true, raw };
        }

        const context = extractRequestContext(body);
        const entry = {
          at: Date.now(),
          method: req.method,
          url: req.url,
          pathname,
          body,
          context,
        };
        requests.push(entry);
        console.error(
          `[fake-model] POST ${pathname} (#${requests.length}) role=${context.role ?? '-'} taskId=${context.taskId ?? '-'}`,
        );

        const chunks = pickScenarioEmit(scenario, context);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.end(chunks.join(''));
      });
      return;
    }

    const entry = {
      at: Date.now(),
      method: req.method,
      url: req.url,
      pathname,
      body: null,
      context: null,
    };
    requests.push(entry);
    console.error(`[fake-model] ${req.method} ${pathname} → 404 (#${requests.length})`);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  return {
    server,
    host,
    requests,
    listen(port = DEFAULT_PORT) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          const address = server.address();
          const resolvedPort =
            address && typeof address === 'object' ? address.port : /** @type {number} */ (port);
          resolve(resolvedPort);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    reset() {
      requests.length = 0;
      matchOccurrenceCounts.clear();
    },
  };
}

function printHelp() {
  console.log(`Usage: node scripts/fake-model-server.mjs [options]

Local OpenAI-v1 fake provider for orchestrate board runs.

Options:
  --port <n>        Listen port (default: ${DEFAULT_PORT}; use 0 for ephemeral)
  --scenario <path> Scenario JSON (ordered match/emit steps)
  --register        Register provider "${FAKE_PROVIDER_ID}" in ~/.minnow/providers
  --help            Show this help

Scenario step shape:
  { "match": { "role": "builder", "taskId": "W1-A", "nth": 0 }, "emit": ["data: ...\\n\\n"] }

Match fields are optional wildcards. "nth" is 0-based per (role, taskId) pair.
Default (no --scenario): builder nth=0 → board_report for that task; nth≥1 → prose ack;
tester → VERDICT: pass; fixer/final follow the headless quirk-fixture pattern.

Recorded requests are logged to stderr and exposed as export { requests }.
`);
}

/**
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  /** @type {{ port: number; scenario?: string; register: boolean; help: boolean }} */
  const out = { port: DEFAULT_PORT, register: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--register') {
      out.register = true;
      continue;
    }
    if (arg === '--port') {
      const next = argv[i + 1];
      if (!next) throw new Error('--port requires a number');
      out.port = Number(next);
      if (!Number.isFinite(out.port) || out.port < 0) throw new Error('--port must be >= 0');
      i += 1;
      continue;
    }
    if (arg === '--scenario') {
      const next = argv[i + 1];
      if (!next) throw new Error('--scenario requires a path');
      out.scenario = next;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

/**
 * @param {string} baseUrl
 */
async function registerFakeProvider(baseUrl) {
  const { createProvider, updateProvider, listProviders } = await import(
    '../server/providers/store.js'
  );
  const body = {
    id: FAKE_PROVIDER_ID,
    label: 'Fake board model',
    baseUrl,
    apiKind: 'openai-v1',
  };
  const { providers } = await listProviders();
  if (providers.some((p) => p.id === FAKE_PROVIDER_ID)) {
    await updateProvider(FAKE_PROVIDER_ID, body);
    console.error(`[fake-model] Updated provider "${FAKE_PROVIDER_ID}" → ${baseUrl}`);
    return;
  }
  await createProvider(body);
  console.error(`[fake-model] Registered provider "${FAKE_PROVIDER_ID}" → ${baseUrl}`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const scenario = await loadScenario(args.scenario);
  const fake = createFakeModelServer({ scenario });
  const port = await fake.listen(args.port);
  const baseUrl = `http://127.0.0.1:${port}`;
  console.error(`[fake-model] Listening on ${baseUrl} (model id: ${FAKE_MODEL_ID})`);

  if (args.register) {
    await registerFakeProvider(baseUrl);
  }

  const shutdown = async () => {
    await fake.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
