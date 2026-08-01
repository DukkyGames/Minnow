export function anthropicModelUsesAdaptiveThinking(modelId: string | null | undefined): boolean;
export function anthropicBudgetTokensToEffort(
  budgetTokens: number | undefined,
): 'low' | 'medium' | 'high';
export function normalizeAnthropicProviderOptions(
  modelId: string | undefined,
  providerOptions: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined;
export function anthropicHistoryHasUnsignedToolCalls(messages: unknown): boolean;
export function anthropicThinkingTypeFromProviderOptions(
  modelId: string | undefined,
  providerOptions: Record<string, Record<string, unknown>> | undefined,
): string | undefined;
export function isAnthropicGatewayBaseUrl(baseUrl: string): boolean;
export function hasOutboundAnthropicTools(body: unknown): boolean;
export function adjustAnthropicRequestForGateway(baseUrl: string, body: unknown): unknown;
export function adjustAnthropicThinkingForToolHistory(modelId: string, body: unknown): unknown;
