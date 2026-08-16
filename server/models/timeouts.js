/**
 * Shared wall-clock budgets for local model load / serve health / provider proxy.
 */

/** llama.cpp health wait, mlx-lm managed-server startup, and provider load/unload proxy. */
export const MODEL_LOAD_TIMEOUT_MS = 180_000;
