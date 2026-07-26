/**
 * Façade for the packaged Session Engine bundle (MIN-354).
 *
 * esbuild entry: every export that server/session loaders need must live here
 * so the bundler can tree-shake / trace reachability from a single point.
 */

export { runEngineMainChatTurn } from './main-chat-loop.ts';
export {
  resumeEngineBoardsOnBoot,
  rebindEngineBoardHostSession,
  activateEngineBoardHost,
  deactivateEngineBoardHost,
  isEngineBoardHostActive,
} from './board-host.ts';
export { applyBoardCommand } from './board-commands.ts';
export {
  bootEngineControllerOnStart,
  activateEngineControllerHost,
} from './controller-host.ts';
export { applyControllerSessionCommand } from './controller-commands.ts';
export {
  parkAskQuestion,
  cancelParkedAskQuestion,
  resolveParkedAskQuestion,
} from './ask-question-bridge.ts';
export {
  buildEngineApiMessages,
  buildEngineHistoryUserContent,
} from './build-api-messages.ts';
export { setSessionStateForEngineHost } from '../state/sessions.ts';
