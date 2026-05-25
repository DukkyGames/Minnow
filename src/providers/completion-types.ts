/**
 * Shared chat completion body extensions (structured output / tool calls).
 */

/** JSON Schema wrapper for OpenAI-compatible structured output. */
export interface ResponseFormatJsonSchema {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

export type ResponseFormat = ResponseFormatJsonSchema;

/** Optional response_format on tool-capable completion bodies. */
export interface CompletionBodyWithResponseFormat {
  response_format?: ResponseFormat;
}
