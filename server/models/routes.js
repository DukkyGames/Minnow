/**
 * HTTP routes for Models download + serve APIs.
 */

import { cancelDownload, listDownloads, startDownload, subscribeDownload } from './download.js';
import { listCachedModels } from './cached.js';
import { listInstalled } from './installed.js';
import { getModelsConfig, patchModelsConfig } from './models-config.js';
import { computeServeProfiles } from './profiles.js';
import { detectRuntimes } from './runtime-detect.js';
import { listServes, startServe, stopServe } from './serve.js';
import { validateJobId, validateServeId } from './validate.js';
import { detectHardware } from '../system/hardware.js';
import {
  getLlamaRuntimeStatus,
  ensureLlamaServer,
  getInstalledLlamaVariant,
  subscribeLlamaInstallProgress,
} from './llama-runtime.js';
import { writeLlamaCppConfig, readLlamaCppConfig, buildLlamaServerArgs } from './llama-args.js';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 */
export async function handleModelsRequest(req, res, pathname) {

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (pathname === '/api/models/ping' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/models/downloads' && req.method === 'GET') {
    const jobs = await listDownloads();
    sendJson(res, 200, { jobs });
    return true;
  }

  if (pathname === '/api/models/download' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const job = await startDownload(body);
      sendJson(res, 200, { job });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const downloadStreamMatch = pathname.match(/^\/api\/models\/download\/([^/]+)\/stream$/);
  if (downloadStreamMatch && req.method === 'GET') {
    const jobId = validateJobId(downloadStreamMatch[1]);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        /* client disconnected — keep download running */
        return;
      }
      if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
        res.end();
      }
    };
    const unsubscribe = subscribeDownload(jobId, send);
    req.on('close', () => unsubscribe());
    return true;
  }

  const downloadCancelMatch = pathname.match(/^\/api\/models\/download\/([^/]+)\/cancel$/);
  if (downloadCancelMatch && req.method === 'POST') {
    try {
      const job = await cancelDownload(validateJobId(downloadCancelMatch[1]));
      sendJson(res, 200, { job });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/api/models/installed' && req.method === 'GET') {
    const payload = await listInstalled();
    sendJson(res, 200, payload);
    return true;
  }

  if (pathname === '/api/models/cached' && req.method === 'GET') {
    const payload = await listCachedModels();
    sendJson(res, 200, payload);
    return true;
  }

  if (pathname === '/api/models/config' && req.method === 'GET') {
    const models = await getModelsConfig();
    const hfToken = typeof models.hfToken === 'string' ? models.hfToken : '';
    sendJson(res, 200, {
      hfTokenConfigured: Boolean(hfToken),
      hfTokenMasked: hfToken ? `${hfToken.slice(0, 4)}…${hfToken.slice(-4)}` : '',
      modelDirs: Array.isArray(models.modelDirs) ? models.modelDirs : [],
    });
    return true;
  }

  if (pathname === '/api/models/config' && req.method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      const patch = {};
      if (typeof body.hfToken === 'string' && body.hfToken.trim()) {
        patch.hfToken = body.hfToken.trim();
      } else if (body.clearHfToken === true) {
        patch.hfToken = '';
      }
      if (Array.isArray(body.modelDirs)) {
        patch.modelDirs = body.modelDirs
          .filter((d) => typeof d === 'string' && d.trim())
          .map((d) => d.trim());
      }
      const models = await patchModelsConfig(patch);
      const { resetHfTokenCache } = await import('./hf-client.js');
      resetHfTokenCache();
      const hfToken = typeof models.hfToken === 'string' ? models.hfToken : '';
      sendJson(res, 200, {
        ok: true,
        hfTokenConfigured: Boolean(hfToken),
        hfTokenMasked: hfToken ? `${hfToken.slice(0, 4)}…${hfToken.slice(-4)}` : '',
        modelDirs: Array.isArray(models.modelDirs) ? models.modelDirs : [],
      });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/api/models/profiles' && req.method === 'GET') {
    try {
      const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
      const modelName = parsed.searchParams.get('model') || '';
      const quant = parsed.searchParams.get('quant') || undefined;
      const weightsGb = parsed.searchParams.get('weights_gb');
      const fresh = parsed.searchParams.get('fresh') === '1';
      const hardware = await detectHardware({ fresh });
      const model = {
        name: modelName,
        parameter_count: parsed.searchParams.get('params') || undefined,
        parameters_raw: parsed.searchParams.get('params_b')
          ? Number(parsed.searchParams.get('params_b'))
          : undefined,
        quantization: quant,
        active_parameters: parsed.searchParams.get('active_params_b')
          ? Number(parsed.searchParams.get('active_params_b'))
          : undefined,
        is_moe: parsed.searchParams.get('is_moe') === '1',
      };
      const profiles = computeServeProfiles(hardware, model, {
        serveWeightsGb: weightsGb ? Number(weightsGb) : undefined,
        serveQuant: quant,
      });
      const variant = (await getInstalledLlamaVariant()) ?? 'cpu';
      const profilesWithArgs = profiles.map((p) => ({
        ...p,
        llama_args: buildLlamaServerArgs({
          modelPath: '/model.gguf',
          port: 8085,
          profileKey: p.key,
          hardware,
          modelMeta: model,
          variant,
        }),
      }));
      sendJson(res, 200, { profiles: profilesWithArgs, hardware });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/api/models/runtimes' && req.method === 'GET') {
    const runtimes = await detectRuntimes();
    sendJson(res, 200, runtimes);
    return true;
  }

  if (pathname === '/api/models/llama-runtime' && req.method === 'GET') {
    try {
      const status = await getLlamaRuntimeStatus();
      sendJson(res, 200, status);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/api/models/llama-runtime/install/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.phase === 'completed' || event.phase === 'failed') {
        res.end();
      }
    };

    const unsubscribe = subscribeLlamaInstallProgress(send);
    req.on('close', () => unsubscribe());
    return true;
  }

  if (pathname === '/api/models/llama-runtime/install' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const variant = typeof body.variant === 'string' ? body.variant : undefined;
      const tag = typeof body.tag === 'string' ? body.tag : undefined;
      const reinstall = body.reinstall === true;
      if (variant) {
        await writeLlamaCppConfig({ variant });
      }
      const path = await ensureLlamaServer({ variant, tag, reinstall });
      const status = await getLlamaRuntimeStatus();
      sendJson(res, 200, { ok: true, path, ...status });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/api/models/llama-cpp-config' && req.method === 'GET') {
    const config = await readLlamaCppConfig();
    sendJson(res, 200, config);
    return true;
  }

  if (pathname === '/api/models/llama-cpp-config' && req.method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      const config = await writeLlamaCppConfig(body);
      sendJson(res, 200, { ok: true, ...config });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/api/models/serve' && req.method === 'GET') {
    const serves = await listServes();
    sendJson(res, 200, { serves });
    return true;
  }

  if (pathname === '/api/models/serve' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const serve = await startServe(body);
      sendJson(res, 200, { serve });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const serveStopMatch = pathname.match(/^\/api\/models\/serve\/([^/]+)\/stop$/);
  if (serveStopMatch && req.method === 'POST') {
    try {
      const serve = await stopServe(validateServeId(serveStopMatch[1]));
      sendJson(res, 200, { serve });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname.startsWith('/api/models')) {
    sendJson(res, 404, { error: 'Not found' });
    return true;
  }

  return false;
}

/** Vite connect middleware factory. */
export function createModelsMiddleware() {
  return async (req, res, next) => {
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/api/models')) {
      next();
      return;
    }
    const handled = await handleModelsRequest(req, res, parsed.pathname);
    if (!handled) next();
  };
}
