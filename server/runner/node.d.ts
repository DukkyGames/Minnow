/**
 * Node-only runner barrel. Vite must not load this file — it re-exports
 * in-process adapters that pull the tool server into the client graph.
 */

export * from './index';
export {
  createCompletionStream,
  postChatCompletionsInProcess,
  RUNNER_FALLBACK_ROLE,
} from './generation-binding';
export type { CompletionStream, CompletionStreamOptions } from './generation-binding';
export { createInProcessToolDispatch, executeInProcessTool } from './tool-dispatch';
export type {
  ExecuteInProcessToolOptions,
  InProcessToolResult,
  CreateInProcessToolDispatchOptions,
  InProcessToolDispatch,
} from './tool-dispatch';
