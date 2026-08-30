/**
 * Node-only runner barrel (MIN-700 / P2-C, MIN-701 / P2-D).
 *
 * Vite follows every static `export … from` in a module it loads, including
 * unused named re-exports. Putting generation-binding and tool-dispatch on the
 * isomorphic `index.js` barrel pulls `tools-middleware`, LSP (`vscode-jsonrpc/node`),
 * and `officeparser`/`file-type` into the client dep optimizer and breaks
 * `npm run desktop`.
 *
 * The renderer keeps importing `createSubAgentRunner` from `index.js`.
 * Server callers that need in-process completions or tool dispatch import here.
 */

export * from './index.js';
export {
  createCompletionStream,
  postChatCompletionsInProcess,
  RUNNER_FALLBACK_ROLE,
} from './generation-binding.js';
export {
  createInProcessToolDispatch,
  executeInProcessTool,
} from './tool-dispatch.js';
