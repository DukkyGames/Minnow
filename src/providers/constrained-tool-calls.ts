/**
 * Apply constrained decoding (response_format) to tool-capable completion bodies.
 */

import type { OpenAIFunctionDefinition } from '../tools/definitions';
import {
  isConstrainedToolCallsAvailable,
  type ProviderCapabilities,
} from './capability-probe';
import { buildToolCallResponseFormat } from './tool-call-schema';
import type { CompletionBodyWithResponseFormat } from './completion-types';

export interface ApplyConstrainedToolCallsInput {
  providerId: string;
  modelId: string;
  userEnabled: boolean;
  capabilities: ProviderCapabilities | null;
  enabledTools: OpenAIFunctionDefinition[];
}

export interface ApplyConstrainedToolCallsResult<T extends CompletionBodyWithResponseFormat> {
  body: T;
  usedConstrained: boolean;
}

/**
 * Attach response_format when user setting + probe allow and tools are present.
 */
export function applyConstrainedToolCallsToBody<T extends CompletionBodyWithResponseFormat>(
  body: T,
  input: ApplyConstrainedToolCallsInput,
): ApplyConstrainedToolCallsResult<T> {
  if (input.enabledTools.length === 0) {
    return { body, usedConstrained: false };
  }
  if (
    !isConstrainedToolCallsAvailable(
      input.providerId,
      input.modelId,
      input.userEnabled,
      input.capabilities,
    )
  ) {
    return { body, usedConstrained: false };
  }

  const responseFormat = buildToolCallResponseFormat(input.enabledTools);
  if (!responseFormat) {
    return { body, usedConstrained: false };
  }

  return {
    body: { ...body, response_format: responseFormat },
    usedConstrained: true,
  };
}

/** Strip response_format for a single retry after upstream rejection. */
export function stripResponseFormatFromBody<T extends CompletionBodyWithResponseFormat>(
  body: T,
): T {
  const { response_format: _rf, ...rest } = body;
  return rest as T;
}

/** Whether an upstream/create error likely means response_format is unsupported. */
export function isResponseFormatRejectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (!lower.includes('400') && !lower.includes('422')) {
    return false;
  }
  return (
    lower.includes('response_format') ||
    lower.includes('json_schema') ||
    lower.includes('grammar') ||
    lower.includes('structured output') ||
    lower.includes('structured_output')
  );
}

/** Dev-only logging when localStorage.minnowDebugConstrained is set. */
export function logConstrainedDebug(event: string, detail?: Record<string, unknown>): void {
  try {
    if (localStorage.getItem('minnowDebugConstrained') !== '1') return;
  } catch {
    return;
  }
  console.info('[constrained]', event, detail ?? '');
}
