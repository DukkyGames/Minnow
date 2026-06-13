/**
 * Detect local inference runtimes (llama.cpp, Ollama, LM Studio).
 */

import { runProcess } from '../process-runner.js';

/**
 * @param {string} cmd
 */
async function which(cmd) {
  try {
    if (process.platform === 'win32') {
      const { code, stdout } = await runProcess('where', [cmd], { timeout: 3_000 });
      if (code === 0 && stdout.trim()) return stdout.trim().split(/\r?\n/)[0];
      return null;
    }
    const { code, stdout } = await runProcess('which', [cmd], { timeout: 3_000 });
    if (code === 0 && stdout.trim()) return stdout.trim().split(/\r?\n/)[0];
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 */
async function probeHttp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{ llamaCpp: { available: boolean, path: string | null }, ollama: { available: boolean, path: string | null, serving: boolean }, lmStudio: { available: boolean, baseUrl: string | null } }>}
 */
export async function detectRuntimes() {
  const [llamaPath, ollamaPath, lmOk, ollamaOk] = await Promise.all([
    which('llama-server'),
    which('ollama'),
    probeHttp('http://127.0.0.1:1234/v1/models'),
    probeHttp('http://127.0.0.1:11434/api/tags'),
  ]);

  return {
    llamaCpp: { available: Boolean(llamaPath), path: llamaPath },
    ollama: {
      available: Boolean(ollamaPath),
      path: ollamaPath,
      serving: ollamaOk,
      baseUrl: ollamaOk ? 'http://127.0.0.1:11434' : null,
    },
    lmStudio: {
      available: lmOk,
      baseUrl: lmOk ? 'http://127.0.0.1:1234' : null,
    },
  };
}
