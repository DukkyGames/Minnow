/**
 * Anthropic extended-thinking style by model id (mirrors @ai-sdk/anthropic getModelCapabilities).
 */

export {
  adjustAnthropicRequestForGateway,
  adjustAnthropicThinkingForToolHistory,
  anthropicBudgetTokensToEffort,
  anthropicHistoryHasUnsignedToolCalls,
  anthropicModelUsesAdaptiveThinking,
  anthropicThinkingTypeFromProviderOptions,
  hasOutboundAnthropicTools,
  isAnthropicGatewayBaseUrl,
  normalizeAnthropicProviderOptions,
} from './anthropic-thinking-style.mjs';
