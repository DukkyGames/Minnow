/**
 * globalThis.fetch replacement for headless board E2E — routes generations, tools,
 * worktree, board-log mirror, and inert config/memory stubs.
 */

import { findChatById, sessionState } from '../../src/state/sessions.ts';
import {
  cleanMergeMocks,
} from './_board-flow-helpers.mts';
import type { BoardLogEvent } from '../../src/types.ts';

/** One scripted generation round — SSE stream and/or HTTP error on create. */
export type FakeApiTurn = {
  sse?: string[];
  /** When set, POST /api/generations returns this error instead of opening a stream. */
  postError?: { status: number; body: string };
};

export type FakeApiScript = {
  /** Keys: `${taskId}:build|test|fix`, or `final` for integration test chat. */
  slots: Record<string, FakeApiTurn[]>;
  toolResults?: Record<string, { result?: string; error?: string }>;
  worktree?: Record<string, unknown>;
};

const DEFAULT_TOOL_FIXTURES: Record<string, { result?: string; error?: string }> = {
  board_provision_infra: {
    result: JSON.stringify({ ok: true, signatures: [] }),
  },
  get_datetime: { result: '2026-07-26T12:00:00Z' },
};

export type FakeApiRouterHandle = {
  restore: () => void;
  boardLogEvents: BoardLogEvent[];
  unroutedRequests: Array<{ method: string; url: string }>;
};

type GenerationBinding = {
  slotKey: string;
  sse: string[];
};

let genCounter = 0;

function nextGenerationId(slotKey: string): string {
  genCounter += 1;
  const tag = slotKey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `gen-${tag}-${genCounter}`;
}

function inertJson(): Response {
  return Response.json({ ok: true });
}

function parseJsonBody(init?: RequestInit): unknown {
  if (!init?.body) return null;
  try {
    return JSON.parse(String(init.body));
  } catch {
    return null;
  }
}

function worktreeResponse(
  op: string,
  script: FakeApiScript,
  worktreeOverrides: Record<string, unknown>,
): unknown {
  const merged = {
    ...cleanMergeMocks(),
    ...(script.worktree ?? {}),
    ...worktreeOverrides,
  };
  return op in merged ? merged[op] : { ok: false, error: `worktree op not_mocked: ${op}` };
}

/** Map a launched board chat id to a stable script slot key. */
export function resolveBoardSlotKey(chatId: string): string {
  const id = chatId.trim();
  const chat = findChatById(id);
  if (!chat) return `unknown:${id}`;

  const group = sessionState?.groups?.find((g) => g.id === chat.boardGroupId?.trim());
  const board = group?.orchestrateBoard;
  if (board?.finalTest?.chatId?.trim() === id) return 'final';

  const taskId = chat.boardTaskId?.trim();
  if (!taskId) return `chat:${id}`;

  if (chat.workAgentId === 'tester') return `${taskId}:test`;

  const task = board?.tasks.find((t) => t.id === taskId);
  if (task?.fixerChatId?.trim() === id) return `${taskId}:fix`;

  return `${taskId}:build`;
}

/** Build an SSE Response from preformatted event chunks (loop-resume pattern). */
export function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** Default prose ack when a slot has no scripted turn (planner wrap-up, extra rounds). */
function defaultAckSse(): string[] {
  const delta = JSON.stringify({
    choices: [{ delta: { content: 'Done.' } }],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
  });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    `event: end\ndata: {"status":"complete"}\n\n`,
  ];
}

/**
 * Replace globalThis.fetch with a deterministic router for headless board tests.
 * Generation POST binds the next scripted SSE turn for the request chatId slot.
 */
export function installFakeApiRouter(
  script: FakeApiScript,
  worktreeOverrides: Record<string, unknown> = {},
): FakeApiRouterHandle {
  const originalFetch = globalThis.fetch;
  const boardLogEvents: BoardLogEvent[] = [];
  const unroutedRequests: Array<{ method: string; url: string }> = [];
  const generationBindings = new Map<string, GenerationBinding>();
  const slotTurnIndex = new Map<string, number>();

  genCounter = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/api/memory/')) {
      return Response.json({ enabled: false });
    }
    if (url.includes('/api/config/')) {
      return inertJson();
    }
    if (url.includes('/api/diagnostics/')) {
      return inertJson();
    }
    if (url.includes('/api/work-agents')) {
      return inertJson();
    }
    if (url.includes('/api/providers')) {
      return Response.json({
        providers: [
          {
            id: 'vite-fallback',
            label: 'LM Studio (local)',
            baseUrl: 'http://localhost:1234',
            apiKind: 'lm-studio-v0',
            enabled: true,
            hasApiKey: false,
            hasBearer: false,
          },
          {
            id: 'test-provider',
            label: 'Test provider',
            baseUrl: 'http://localhost:1234',
            apiKind: 'openai-v1',
            enabled: true,
            hasApiKey: false,
            hasBearer: false,
          },
        ],
        models: [{ id: 'm1', object: 'model' }],
        activeProviderId: 'vite-fallback',
      });
    }

    if (url.includes('/api/models/cached') && method === 'GET') {
      return Response.json({ models: [] });
    }
    if (url.includes('/api/models/serve') && method === 'GET') {
      return Response.json({ serves: [] });
    }

    // Model picker / library paths probe hardware when merging My Models rows.
    if (url.includes('/api/system/hardware') && method === 'GET') {
      return Response.json({
        os: 'linux',
        platform: 'linux',
        arch: 'x64',
        cpuName: 'CI',
        cpuCores: 4,
        totalRamGb: 16,
        availableRamGb: 8,
        hasGpu: false,
        gpuName: null,
        gpuVramGb: null,
        gpuCount: 0,
        gpus: [],
        gpuGroups: [],
        homogeneous: true,
        backend: 'cpu',
        unifiedMemory: false,
        detectedAt: 1,
      });
    }

    if (url.includes('/api/workspace/dev-server') || url.includes('/api/terminal/')) {
      return Response.json({ ok: true });
    }

    if (url.includes('/api/desktop-workspace')) {
      if (url.includes('/api/desktop-workspace/list')) {
        return Response.json({ entries: [] });
      }
      if (url.includes('/api/desktop-workspace/download')) {
        return new Response('', { status: 200 });
      }
      if (method === 'PUT') {
        return Response.json({
          ok: true,
          path: '/tmp/minnow-desktop-workspace',
          label: 'workspace',
          fileCount: 0,
        });
      }
      return Response.json({
        ok: true,
        path: '/tmp/minnow-desktop-workspace',
        label: 'workspace',
        fileCount: 0,
      });
    }

    if (url.includes('/api/orchestrate/board-log')) {
      if (method === 'GET') {
        return new Response(null, { status: 204 });
      }
      if (method === 'POST') {
        const body = parseJsonBody(init) as { event?: BoardLogEvent } | null;
        if (body?.event) boardLogEvents.push(body.event);
        return Response.json({ ok: true });
      }
    }

    if (url.endsWith('/api/generations') && method === 'POST') {
      const body = parseJsonBody(init) as { chatId?: string } | null;
      const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
      const slotKey = chatId ? resolveBoardSlotKey(chatId) : 'unknown';
      const slotScript = script.slots[slotKey];
      const turnIdx = slotTurnIndex.get(slotKey) ?? 0;
      const turn = slotScript?.[turnIdx];
      if (turn?.postError) {
        slotTurnIndex.set(slotKey, turnIdx + 1);
        return new Response(turn.postError.body, {
          status: turn.postError.status,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      const sse = turn?.sse?.length ? turn.sse : defaultAckSse();
      slotTurnIndex.set(slotKey, turnIdx + 1);
      const generationId = nextGenerationId(slotKey);
      generationBindings.set(generationId, { slotKey, sse });
      return Response.json({ generationId });
    }

    const streamMatch = url.match(/\/api\/generations\/([^/]+)\/stream/);
    if (streamMatch && method === 'GET') {
      const binding = generationBindings.get(streamMatch[1]);
      if (!binding) {
        return new Response('not found', { status: 404 });
      }
      return sseResponse(binding.sse);
    }

    if (url.includes('/api/generations/') && url.includes('/cancel')) {
      return Response.json({ ok: true });
    }

    if (url.endsWith('/api/tools') && method === 'POST') {
      const body = parseJsonBody(init) as { name?: string } | null;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const fixture = name
        ? (script.toolResults?.[name] ?? DEFAULT_TOOL_FIXTURES[name])
        : undefined;
      if (fixture) {
        return Response.json(fixture);
      }
      return Response.json({ result: `ok:${name}` });
    }

    if (url.includes('/api/tools/ping')) {
      return Response.json({ ok: true });
    }

    if (url.endsWith('/api/worktree') && method === 'POST') {
      const body = parseJsonBody(init) as { op?: string } | null;
      const op = typeof body?.op === 'string' ? body.op : '';
      const payload = worktreeResponse(op, script, worktreeOverrides);
      return Response.json(payload);
    }

    if (url.includes('/api/preview/file/') && method === 'GET') {
      return new Response('# stub\n', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    unroutedRequests.push({ method, url });
    return new Response('not found', { status: 404 });
  };

  return {
    boardLogEvents,
    unroutedRequests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

/** Assert zero unrouted fetch calls — call at end of each headless scenario. */
export function assertZeroUnrouted(handle: FakeApiRouterHandle): void {
  if (handle.unroutedRequests.length > 0) {
    const sample = handle.unroutedRequests
      .slice(0, 5)
      .map((r) => `${r.method} ${r.url}`)
      .join('; ');
    throw new Error(`unrouted fetch requests (${handle.unroutedRequests.length}): ${sample}`);
  }
}
