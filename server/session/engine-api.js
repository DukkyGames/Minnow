/**
 * Thin re-export surface so command handlers can import engine helpers without
 * a circular module graph (engine → commands → engine).
 *
 * Prefer importing from here inside command modules; engine.js owns the state.
 */

export {
  abortEngineTurn,
  beginEngineTurn,
  commitEngineState,
  endEngineTurn,
  ensureSessionEngineBooted,
  flushEngineStateNow,
  getEngineSessionState,
  isEngineTurnActive,
  mutateEngineState,
  resetSessionEngineForTests,
} from './engine.js';
