export { createModelsMiddleware, handleModelsRequest } from './routes.js';
export { shutdownAllModelServes, reconcileServesOnBoot } from './serve.js';
export { reconcileRouterOnBoot, stopRouter } from './llama-router.js';

import { shutdownAllModelServes } from './serve.js';
import { stopRouter } from './llama-router.js';

/** Stop router and legacy per-model serves on shutdown. */
export async function shutdownAllModelInfrastructure() {
  await stopRouter();
  await shutdownAllModelServes();
}
