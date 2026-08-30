/**
 * Parse gpt-oss Harmony-format tool calls embedded in assistant `content`
 * when the provider streams commentary-channel output instead of `tool_calls`.
 */
import type { ToolCall } from '../../src/types.js';
/** Strip Harmony namespaces so `functions.read_file` becomes `read_file`. */
export declare function normalizeHarmonyToolName(raw: string): string;
/** Extract a balanced `{…}` JSON object starting at `startIndex`. */
export declare function extractBalancedJsonObject(text: string, startIndex: number): string | null;
/**
 * Parse Harmony commentary tool calls from assistant text.
 * Supports canonical `<|message|>{json}` and LM Studio `code{json}` variants.
 */
export declare function tryParseHarmonyToolCallsFromText(text: string): ToolCall[];
