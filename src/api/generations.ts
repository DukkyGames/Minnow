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
  return trimmed;
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

export interface SubscribeToGenerationOptions {
  signal?: AbortSignal;
  onStreamOpen?: () => void;
  onChunk: (chunk: ChatCompletionChunk) => void;
  onEnd?: (event?: GenerationEndEvent) => void;
  onTransportError?: (err: unknown) => void;
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
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let endIndex = buffer.indexOf('\n\n');
        while (endIndex >= 0) {
          const block = buffer.slice(0, endIndex);
          buffer = buffer.slice(endIndex + 2);

          const endPayload = parseEndEventBlock(block);
          if (endPayload) {
            options.onEnd?.(endPayload);
            return;
          }

          if (block.trim()) {
            feedSseBlock(block, options.onChunk);
          }

          endIndex = buffer.indexOf('\n\n');
        }
      }

      if (buffer.trim()) {
        const endPayload = parseEndEventBlock(buffer);
        if (endPayload) {
          options.onEnd?.(endPayload);
          return;
        }
        feedSseBlock(buffer, options.onChunk);
      }

      options.onEnd?.();
    } catch (err) {
      if (cancelled) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
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
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let endIndex = buffer.indexOf('\n\n');
        while (endIndex >= 0) {
          const block = buffer.slice(0, endIndex);
          buffer = buffer.slice(endIndex + 2);

          const endPayload = parseEndEventBlock(block);
          if (endPayload) {
            handlers.onEnd?.(endPayload);
            return;
          }

          if (block.trim()) {
            handlers.onChunk(block.endsWith('\n') ? block : `${block}\n`);
          }

          endIndex = buffer.indexOf('\n\n');
        }
      }

      if (buffer.trim()) {
        const endPayload = parseEndEventBlock(buffer);
        if (endPayload) {
          handlers.onEnd?.(endPayload);
          return;
        }
        handlers.onChunk(buffer.endsWith('\n') ? buffer : `${buffer}\n`);
      }

      handlers.onEnd?.();
    } catch (err) {
      if (cancelled) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
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
