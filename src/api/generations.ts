/**
 * Client for backend-owned LLM generations (/api/generations).
 * Main chat uses persist:true; headless callers use persist:false (30s eviction).
 */

import { parseSseEventBlock } from './sse-parse';
import type { ChatCompletionChunk } from '../types';

/** Terminal SSE payload from the server `event: end` sentinel. */
export interface GenerationEndEvent {
  status: 'complete' | 'error' | 'cancelled';
  errorMessage?: string;
  fallbackUsed?: boolean;
  chosenProviderId?: string;
  chosenModelId?: string;
}

/** Role or routing-row key for server-side fallback chain lookup. */
export type FallbackRole = string;

export class GenerationNotFoundError extends Error {
  constructor() {
    super('Generation not found');
    this.name = 'GenerationNotFoundError';
  }
}

/** User-facing copy when a persisted generation id no longer exists (server restart). */
export const GENERATION_LOST_ON_RESTART_MESSAGE =
  'This reply was lost when the server restarted.';

/**
 * Replace opaque fetch-abort copy with an actionable message (timeouts, stale tabs).
 */
export function formatGenerationErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Unknown error';
  const lower = trimmed.toLowerCase();
  if (
    lower === 'this operation was aborted' ||
    lower === 'the operation was aborted' ||
    lower === 'aborted' ||
    lower.includes('operation was aborted')
  ) {
    return 'The connection to the model was interrupted (timeout or server restart). Try again.';
  }
  if (
    trimmed === 'UND_ERR_BODY_TIMEOUT' ||
    trimmed === 'UND_ERR_HEADERS_TIMEOUT' ||
    trimmed === 'UND_ERR_CONNECT_TIMEOUT' ||
    lower.includes('und_err_body_timeout') ||
    lower.includes('und_err_headers_timeout')
  ) {
    return 'The model stopped sending data for several minutes (connection timed out). Try again, shorten context, or adjust Generation timeouts in Settings → Agents → Watchdog.';
  }
  if (
    lower.includes('upstream http 503') ||
    lower.includes('inference is temporarily unavailable')
  ) {
    return 'The model provider is temporarily unavailable (HTTP 503). Load a model in LM Studio, wait for it to finish loading, or switch the top-bar model and try again.';
  }
  return trimmed;
}

/** True when a generation `event: end` error payload is a server idle/max timeout. */
export function isGenerationTimeoutError(message: string | undefined): boolean {
  const trimmed = message?.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower.includes('stopped sending data') ||
    lower.includes('server limit') ||
    lower.includes('connection timed out')
  );
}

export interface CreateGenerationOptions {
  /** When true, generation state survives 5 minutes after terminal (main chat). */
  persist?: boolean;
  /** Optional role for server-side fallback chain resolution. */
  fallbackRole?: FallbackRole;
  /** Active chat id for webhook chat.completed payloads. */
  chatId?: string;
}

/**
 * Start a backend-owned completion; returns immediately with a generation id.
 */
export async function createGeneration(
  providerId: string,
  body: unknown,
  options: CreateGenerationOptions = {},
): Promise<{ generationId: string }> {
  const res = await fetch('/api/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId,
      body,
      persist: options.persist === true,
      ...(options.fallbackRole ? { fallbackRole: options.fallbackRole } : {}),
      ...(options.chatId ? { chatId: options.chatId } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  const payload = (await res.json()) as { generationId?: string };
  const generationId =
    typeof payload.generationId === 'string' ? payload.generationId.trim() : '';
  if (!generationId) {
    throw new Error('Missing generationId in response');
  }
  return { generationId };
}

/**
 * After this many `\n\n` SSE blocks from one `read()`, yield so input can run
 * (MIN-729). Events are not dropped — remaining blocks process after the yield.
 */
export const SSE_BLOCKS_PER_YIELD = 8;

type SchedulerWithYield = { yield: () => Promise<void> };

/** Prefer `scheduler.yield()`, then rAF, then a 0 ms timeout. */
export function yieldForSseBurst(): Promise<void> {
  const sched = (globalThis as typeof globalThis & { scheduler?: SchedulerWithYield })
    .scheduler;
  if (sched && typeof sched.yield === 'function') {
    return sched.yield();
  }
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Walk `\n\n`-delimited SSE blocks in `buffer`, yielding every
 * {@link SSE_BLOCKS_PER_YIELD} non-empty blocks. Returns `'stop'` when
 * `onBlock` says so (terminal `event: end`).
 */
async function consumeSseBlocks(
  bufferRef: { value: string },
  cancelled: () => boolean,
  onBlock: (block: string) => 'continue' | 'stop',
): Promise<'continue' | 'stop'> {
  let sinceYield = 0;
  let endIndex = bufferRef.value.indexOf('\n\n');
  while (endIndex >= 0) {
    if (cancelled()) return 'stop';
    const block = bufferRef.value.slice(0, endIndex);
    bufferRef.value = bufferRef.value.slice(endIndex + 2);
    const action = onBlock(block);
    if (action === 'stop') return 'stop';
    if (block.trim()) {
      sinceYield += 1;
      if (sinceYield >= SSE_BLOCKS_PER_YIELD) {
        sinceYield = 0;
        // Skip the yield when this read's buffer is already drained — the next
        // `reader.read()` awaits on its own.
        if (bufferRef.value.indexOf('\n\n') >= 0) {
          await yieldForSseBurst();
        }
      }
    }
    endIndex = bufferRef.value.indexOf('\n\n');
  }
  return 'continue';
}

export interface SubscribeToGenerationOptions {
  signal?: AbortSignal;
  onStreamOpen?: () => void;
  onChunk: (chunk: ChatCompletionChunk) => void;
  onEnd?: (event?: GenerationEndEvent) => void;
  onTransportError?: (err: unknown) => void;
  onAbort?: () => void;
}

/**
 * Subscribe to a generation stream (replay from zero, then live tail).
 * Parses upstream `data:` SSE lines via {@link parseSsePayloads}; terminal `event: end` is handled here.
 */
export function subscribeToGeneration(
  generationId: string,
  options: SubscribeToGenerationOptions,
): () => void {
  const controller = new AbortController();
  const combined = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  let cancelled = false;

  void (async () => {
    try {
      const res = await fetch(`/api/generations/${generationId}/stream`, {
        method: 'GET',
        signal: combined,
      });

      if (res.status === 404) {
        throw new GenerationNotFoundError();
      }

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status}: ${err}`);
      }

      options.onStreamOpen?.();

      if (!res.body) {
        throw new Error('Missing response body');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const bufferRef = { value: '' };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled) return;

        bufferRef.value += decoder.decode(value, { stream: true });

        const consumed = await consumeSseBlocks(bufferRef, () => cancelled, (block) => {
          const endPayload = parseEndEventBlock(block);
          if (endPayload) {
            options.onEnd?.(endPayload);
            return 'stop';
          }
          if (block.trim()) {
            feedSseBlock(block, options.onChunk);
          }
          return 'continue';
        });
        if (consumed === 'stop' || cancelled) return;
      }

      if (bufferRef.value.trim()) {
        const endPayload = parseEndEventBlock(bufferRef.value);
        if (endPayload) {
          options.onEnd?.(endPayload);
          return;
        }
        feedSseBlock(bufferRef.value, options.onChunk);
      }

      options.onEnd?.();
    } catch (err) {
      if (cancelled) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        options.onAbort?.();
        return;
      }
      options.onTransportError?.(err);
    }
  })();

  return () => {
    cancelled = true;
    controller.abort();
  };
}

export interface SubscribeToGenerationRawHandlers {
  onChunk: (text: string) => void;
  onEnd?: (event?: GenerationEndEvent) => void;
  onTransportError?: (err: unknown) => void;
  onAbort?: () => void;
}

/**
 * Raw-byte subscribe for {@link postChatCompletions} shim (replays verbatim SSE blocks).
 */
export function subscribeToGenerationRaw(
  generationId: string,
  handlers: SubscribeToGenerationRawHandlers,
  signal?: AbortSignal,
): () => void {
  const controller = new AbortController();
  const combined = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  let cancelled = false;

  void (async () => {
    try {
      const res = await fetch(`/api/generations/${generationId}/stream`, {
        method: 'GET',
        signal: combined,
      });

      if (res.status === 404) {
        throw new GenerationNotFoundError();
      }

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status}: ${err}`);
      }

      if (!res.body) {
        throw new Error('Missing response body');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const bufferRef = { value: '' };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled) return;

        bufferRef.value += decoder.decode(value, { stream: true });

        const consumed = await consumeSseBlocks(bufferRef, () => cancelled, (block) => {
          const endPayload = parseEndEventBlock(block);
          if (endPayload) {
            handlers.onEnd?.(endPayload);
            return 'stop';
          }
          if (block.trim()) {
            // Preserve SSE event boundaries (`\n\n`). The inner runner's
            // feedSseEventBuffer will not parse a `data:` line until the blank
            // line arrives — a single trailing newline left tool_streaming
            // stuck until the generation ended (P6-D).
            const framed = `${block.replace(/\n+$/, '')}\n\n`;
            handlers.onChunk(framed);
          }
          return 'continue';
        });
        if (consumed === 'stop' || cancelled) return;
      }

      if (bufferRef.value.trim()) {
        const endPayload = parseEndEventBlock(bufferRef.value);
        if (endPayload) {
          handlers.onEnd?.(endPayload);
          return;
        }
        handlers.onChunk(`${bufferRef.value.replace(/\n+$/, '')}\n\n`);
      }

      handlers.onEnd?.();
    } catch (err) {
      if (cancelled) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        handlers.onAbort?.();
        return;
      }
      handlers.onTransportError?.(err);
    }
  })();

  return () => {
    cancelled = true;
    controller.abort();
  };
}

/** Cancel upstream generation (Stop button). */
export async function cancelGeneration(generationId: string): Promise<void> {
  const res = await fetch(`/api/generations/${generationId}/cancel`, {
    method: 'POST',
  });
  if (res.status === 404) {
    return;
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }
}

function feedSseBlock(block: string, onChunk: (chunk: ChatCompletionChunk) => void): void {
  if (!block.trim()) return;
  parseSseEventBlock(block, onChunk);
}

function parseEndEventBlock(block: string): GenerationEndEvent | null {
  const lines = block.split('\n');
  let eventName: string | null = null;
  let dataLine: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      eventName = trimmed.slice(6).trim();
    } else if (trimmed.startsWith('data:')) {
      dataLine = trimmed.slice(5).trim();
    }
  }

  if (eventName !== 'end' || !dataLine) {
    return null;
  }

  try {
    const parsed = JSON.parse(dataLine) as GenerationEndEvent;
    if (
      parsed.status === 'complete' ||
      parsed.status === 'error' ||
      parsed.status === 'cancelled'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
