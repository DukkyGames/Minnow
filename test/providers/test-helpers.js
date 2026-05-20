/**
 * Shared helpers for provider API tests (temp MINNOW_HOME + HTTP server).
 */

import http from 'node:http';
import { setTestHome, rmTestHome, createConfigTestServer } from '../config/test-helpers.js';
import { handleProviderRequest } from '../../server/providers/routes.js';
import { handleConfigRequest } from '../../server/config/middleware.js';

export { setTestHome, rmTestHome };

/** Minimal server: config + providers middleware. */
export function createProviderTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleProviderRequest(req, res, url.pathname).then((handled) => {
      if (handled) return;
      void handleConfigRequest(req, res, url.pathname).then((configHandled) => {
        if (!configHandled) {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    });
  });
}

export { httpRequest } from '../config/test-helpers.js';
