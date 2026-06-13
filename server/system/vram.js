/**
 * Best-effort GPU VRAM probe for the Vibe Coding Hub (GET /api/system/vram).
 */

import { runProcess } from '../process-runner.js';

/** Short cache — VRAM changes quickly while models load. */
const VRAM_CACHE_TTL_MS = 2_500;

let vramCache = { at: 0, payload: { available: false } };

/**
 * Parse the first line of nvidia-smi CSV output: usedMb,totalMb.
 * @param {string} stdout
 * @returns {{ available: true, usedMb: number, totalMb: number } | { available: false }}
 */
export function parseNvidiaSmiVram(stdout) {
  const line = stdout.trim().split(/\r?\n/).find((row) => row.trim());
  if (!line) return { available: false };
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 2) return { available: false };
  const usedMb = Number(parts[0]);
  const totalMb = Number(parts[1]);
  if (!Number.isFinite(usedMb) || !Number.isFinite(totalMb) || totalMb <= 0) {
    return { available: false };
  }
  return { available: true, usedMb, totalMb };
}

/**
 * Parse nvidia-smi memory.total,name CSV — ports Odysseus _detect_nvidia row parser.
 * @param {string} stdout
 * @returns {{ available: false, unified?: Array<{ index: number, name: string }> } | { available: true, gpus: Array<{ index: number, name: string, vramGb: number }> }}
 */
export function parseNvidiaSmiGpu(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter((row) => row.trim());
  if (!lines.length) return { available: false };

  /** @type {Array<{ index: number, name: string, vramGb: number }>} */
  const gpus = [];
  /** @type {Array<{ index: number, name: string }>} */
  const unified = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const parts = lines[idx].split(',').map((p) => p.trim());
    if (parts.length < 2) continue;
    const vramMb = Number(parts[0]);
    const name = parts[1];
    if (Number.isFinite(vramMb) && vramMb > 0) {
      gpus.push({ index: idx, name, vramGb: vramMb / 1024 });
    } else if (name) {
      unified.push({ index: idx, name });
    }
  }

  if (gpus.length) return { available: true, gpus };
  if (unified.length) return { available: false, unified };
  return { available: false };
}

/**
 * Query the first NVIDIA GPU via nvidia-smi.
 * @returns {Promise<{ available: boolean, usedMb?: number, totalMb?: number }>}
 */
export async function probeVram() {
  const now = Date.now();
  if (now - vramCache.at < VRAM_CACHE_TTL_MS) {
    return vramCache.payload;
  }

  try {
    const { code, stdout } = await runProcess(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 3_000 },
    );
    if (code !== 0) {
      vramCache = { at: now, payload: { available: false } };
      return vramCache.payload;
    }
    const parsed = parseNvidiaSmiVram(stdout);
    vramCache = { at: now, payload: parsed };
    return parsed;
  } catch {
    vramCache = { at: now, payload: { available: false } };
    return vramCache.payload;
  }
}
