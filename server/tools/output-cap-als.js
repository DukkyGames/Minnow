/**
 * Node-only AsyncLocalStorage for output-cap policy (MIN-667).
 * The tool server imports this file. The Vite SPA must not — `node:async_hooks`
 * is externalized in the browser and throws if the renderer loads it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { installOutputCapStore } from './output-cap.js';

const outputCapAls = new AsyncLocalStorage();

installOutputCapStore({
  getStore: () => outputCapAls.getStore(),
  run: (policy, fn) => outputCapAls.run(policy, fn),
});
