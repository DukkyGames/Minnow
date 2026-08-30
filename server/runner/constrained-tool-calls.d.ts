/**
 * Apply constrained decoding (response_format) to tool-capable completion bodies.
 */
import type { OpenAIFunctionDefinition } from '../../src/tools/definitions.js';
import { type ProviderCapabilities } from './capability-probe.js';
import type { CompletionBodyWithResponseFormat } from '../../src/providers/completion-types.js';
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
export declare function applyConstrainedToolCallsToBody<T extends CompletionBodyWithResponseFormat>(body: T, input: ApplyConstrainedToolCallsInput): ApplyConstrainedToolCallsResult<T>;
/** Strip response_format for a single retry after upstream rejection. */
export declare function stripResponseFormatFromBody<T extends CompletionBodyWithResponseFormat>(body: T): T;
/** Whether an upstream/create error likely means response_format is unsupported. */
export declare function isResponseFormatRejectionError(err: unknown): boolean;
/** Dev-only logging when localStorage.minnowDebugConstrained is set. */
export declare function logConstrainedDebug(event: string, detail?: Record<string, unknown>): void;
