/**
 * Stable local-serve provider ids.
 *
 * Duplicated as literals so `server/runner/` never imports `src/` or the Node
 * provider store (which pulls `fs` into a Vite graph). Keep in lockstep with
 * `src/models/runtime-ids.mjs`.
 */

export const LLAMA_CPP_LOCAL_PROVIDER_ID = 'llama-cpp-local';
export const MLX_LM_LOCAL_PROVIDER_ID = 'mlx-lm-local';
