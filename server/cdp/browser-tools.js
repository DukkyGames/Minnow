/**
 * CDP browser automation tool handlers (opencode-browser pattern).
 */

import { connectTarget } from './client.js';
import { listTargets, findPageTarget } from './targets.js';
import { takeSnapshot, resolveUid } from './snapshot.js';
import * as snapshotCache from './snapshot-cache.js';
import {
  assertNavigationAllowed,
  consumeEphemeralNavigation,
  originFromUrl,
} from './allowlist.js';
import {
  assertBrowserEnabled,
  loadBrowserConfig,
  resolveBrowserUrl,
} from './browser-config.js';
import { writeScreenshot } from './paths.js';

/**
 * Connect to a page target; closes client in caller finally block.
 * @param {string} browserUrl
 * @param {string | undefined} targetId
 */
async function withPageClient(browserUrl, targetId, fn) {
  const targets = await listTargets(browserUrl);
  const page = findPageTarget(targets, targetId);
  if (!page) {
    throw new Error('No page target found');
  }
  const client = await connectTarget(page.webSocketDebuggerUrl);
  try {
    return await fn(client, page);
  } finally {
    client.close();
  }
}

/**
 * @param {Record<string, unknown>} args
 */
async function guardBrowserTool(fn) {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}

export async function toolBrowserList(args) {
  return guardBrowserTool(async () => {
  const cfg = await loadBrowserConfig();
  await assertBrowserEnabled(cfg);
  const browserUrl = await resolveBrowserUrl(args);
  const targets = await listTargets(browserUrl);
  const pages = targets.filter((t) => t.type === 'page');
  if (pages.length === 0) {
    return 'No page targets found.';
  }
  return pages.map((t) => `[${t.id}] ${t.title}\n  ${t.url}`).join('\n\n');
  });
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolBrowserNavigate(args) {
  const cfg = await loadBrowserConfig();
  await assertBrowserEnabled(cfg);
  if (!cfg.allowNavigate) {
    throw new Error('navigation is disabled in settings');
  }
  const url = args?.url;
  if (!url || typeof url !== 'string') {
    return 'Error: url is required';
  }
  try {
    assertNavigationAllowed(url, cfg.allowedOriginPatterns);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }

  const browserUrl = await resolveBrowserUrl(args);
  const targetId = typeof args.target_id === 'string' ? args.target_id : undefined;

  return withPageClient(browserUrl, targetId, async (client) => {
    await client.send('Page.enable');
    const loadPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Page load timeout')), 10000);
      client.on('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await client.send('Page.navigate', { url });
    try {
      await loadPromise;
    } catch {
      /* continue if load event missed */
    }
    const titleResult = await client.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    });
    const title =
      /** @type {string} */ (
        titleResult?.result?.value != null ? String(titleResult.result.value) : ''
      );
    snapshotCache.clearSnapshotCache();
    consumeEphemeralNavigation(originFromUrl(url));
    return `Navigated to: ${url}\nTitle: ${title || '(no title)'}`;
  });
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolBrowserSnapshot(args) {
  const cfg = await loadBrowserConfig();
  await assertBrowserEnabled(cfg);
  const browserUrl = await resolveBrowserUrl(args);
  const targetId = typeof args.target_id === 'string' ? args.target_id : undefined;
  const key = snapshotCache.cacheKey(browserUrl, targetId);

  return withPageClient(browserUrl, targetId, async (client) => {
    await client.send('Accessibility.enable');
    const snap = await takeSnapshot(client);
    snapshotCache.setSnapshot(key, snap);

    if (!snap.text || snap.text === '(empty page)') {
      const bodyResult = await client.send('Runtime.evaluate', {
        expression: 'document.body ? document.body.innerText : ""',
        returnByValue: true,
      });
      const inner =
        /** @type {string} */ (
          bodyResult?.result?.value != null ? String(bodyResult.result.value) : ''
        );
      const fallback = inner.slice(0, 3000);
      if (fallback) {
        return fallback;
      }
    }
    return snap.text;
  });
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolBrowserClick(args) {
  const cfg = await loadBrowserConfig();
  await assertBrowserEnabled(cfg);
  const uid = Number(args?.uid);
  if (!Number.isFinite(uid)) {
    return 'Error: uid is required';
  }

  const browserUrl = await resolveBrowserUrl(args);
  const targetId = typeof args.target_id === 'string' ? args.target_id : undefined;
  const key = snapshotCache.cacheKey(browserUrl, targetId);
  const snap = snapshotCache.getSnapshot(key);
  if (!snap) {
    return 'No snapshot cached. Call browser_snapshot first.';
  }
  const node = resolveUid(snap, uid);
  if (!node) {
    return `Error: uid ${uid} not found in snapshot`;
  }

  return withPageClient(browserUrl, targetId, async (client) => {
    try {
      const box = await client.send('DOM.getBoxModel', {
        backendNodeId: node.backendNodeId,
      });
      const quad = /** @type {number[]} */ (box.model?.content);
      if (quad && quad.length >= 8) {
        const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
        const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
        await client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button: 'left',
          clickCount: 1,
        });
        return `Clicked [${uid}] ${node.role} "${node.name}"`;
      }
    } catch {
      /* fallback to element.click() */
    }

    const resolved = await client.send('DOM.resolveNode', {
      backendNodeId: node.backendNodeId,
    });
    const objectId = resolved.object?.objectId;
    if (objectId) {
      await client.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function() { this.click(); }',
        arguments: [],
      });
      return `Clicked [${uid}] ${node.role} "${node.name}"`;
    }
    return `Error: could not click uid ${uid}`;
  });
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolBrowserFill(args) {
  const cfg = await loadBrowserConfig();
  await assertBrowserEnabled(cfg);
  const uid = Number(args?.uid);
  const value = args?.value != null ? String(args.value) : '';
  if (!Number.isFinite(uid)) {
    return 'Error: uid is required';
  }

  const browserUrl = await resolveBrowserUrl(args);
  const targetId = typeof args.target_id === 'string' ? args.target_id : undefined;
  const key = snapshotCache.cacheKey(browserUrl, targetId);
  const snap = snapshotCache.getSnapshot(key);
  if (!snap) {
    return 'No snapshot cached. Call browser_snapshot first.';
  }
  const node = resolveUid(snap, uid);
  if (!node) {
    return `Error: uid ${uid} not found in snapshot`;
  }

  return withPageClient(browserUrl, targetId, async (client) => {
    const resolved = await client.send('DOM.resolveNode', {
      backendNodeId: node.backendNodeId,
    });
    const objectId = resolved.object?.objectId;
    if (!objectId) {
      return `Error: could not resolve uid ${uid}`;
    }

    await client.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function(v) {
        this.focus();
        if ('value' in this) this.value = '';
        this.textContent = '';
      }`,
      arguments: [{ value }],
    });

    for (const ch of value) {
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: ch,
      });
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        text: ch,
      });
    }

    await client.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function(v) {
        if ('value' in this) this.value = v;
        this.dispatchEvent(new Event('input', { bubbles: true }));
      }`,
      arguments: [{ value }],
    });

    return `Filled [${uid}] with "${value}"`;
  });
}

/**
 * @param {Record<string, unknown>} args
 */
export async function toolBrowserEval(args) {
  const cfg = await loadBrowserConfig();
  await assertBrowserEnabled(cfg);
  const expression = args?.expression;
  if (!expression || typeof expression !== 'string') {
    return 'Error: expression is required';
  }

  const browserUrl = await resolveBrowserUrl(args);
  const targetId = typeof args.target_id === 'string' ? args.target_id : undefined;

  return withPageClient(browserUrl, targetId, async (client) => {
    try {
      const result = await client.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        const desc =
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          'evaluation failed';
        return `Error: ${desc}`;
      }
      const val = result.result?.value;
      if (val === undefined) return '(undefined)';
      if (typeof val === 'object') return JSON.stringify(val, null, 2);
      return String(val);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  });
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ result: string; attachments: Array<{ type: string; url: string; mime: string; alt?: string }> }>}
 */
export async function toolBrowserScreenshot(args) {
  const cfg = await loadBrowserConfig();
  await assertBrowserEnabled(cfg);
  const browserUrl = await resolveBrowserUrl(args);
  const targetId = typeof args.target_id === 'string' ? args.target_id : undefined;
  const testId = typeof args._testScreenshotId === 'string' ? args._testScreenshotId : undefined;

  const pngBuffer = await withPageClient(browserUrl, targetId, async (client) => {
    await client.send('Page.enable');
    const result = await client.send('Page.captureScreenshot', { format: 'png' });
    const data = result.data;
    if (!data || typeof data !== 'string') {
      throw new Error('screenshot capture returned no data');
    }
    return Buffer.from(data, 'base64');
  });

  const { id, sizeBytes } = await writeScreenshot(pngBuffer, testId);
  const url = `/api/browser/screenshot/${id}`;
  const kb = Math.round(sizeBytes / 1024);
  const text = `Screenshot saved: ${id}.png\nURL: ${url}\n(${kb} KB)`;

  return {
    result: text,
    attachments: [
      {
        type: 'image',
        url,
        mime: 'image/png',
        alt: 'Browser screenshot',
      },
    ],
  };
}

/** Map tool names to handlers. */
export const BROWSER_TOOL_HANDLERS = {
  browser_list: toolBrowserList,
  browser_navigate: toolBrowserNavigate,
  browser_snapshot: toolBrowserSnapshot,
  browser_click: toolBrowserClick,
  browser_fill: toolBrowserFill,
  browser_eval: toolBrowserEval,
  browser_screenshot: toolBrowserScreenshot,
};
