/**
 * Thin re-export surface so command handlers can import engine helpers without
 * a circular module graph (engine → commands → engine).
 *
 * Prefer importing from here inside command modules; engine.js owns the state.
 */

export {
  abortEngineTurn,
  adoptExternalSessionWrite,
  beginEngineTurn,
  commitEngineState,
  endEngineTurn,
  ensureSessionEngineBooted,
  flushEngineStateNow,
  getEngineSessionState,
  isEngineTurnActive,
  mutateEngineState,
  publishLiveEngineState,
  resetSessionEngineForTests,
  tryBeginEngineTurn,
} from './engine.js';
