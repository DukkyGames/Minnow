/**
 * Stable provider ids for in-process llama.cpp / mlx-lm serves.
 *
 * One module so the server store, client types, and sanitizer id-fallbacks cannot
 * drift if a string is renamed. Re-exported from `server/providers/store.js` as
 * `LLAMA_CPP_LOCAL_ID` / `MLX_LM_LOCAL_ID` so existing imports keep working.
 */

export const LLAMA_CPP_LOCAL_ID = 'llama-cpp-local';
export const MLX_LM_LOCAL_ID = 'mlx-lm-local';
