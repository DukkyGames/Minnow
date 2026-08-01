/**
 * llama-server log parsing — load progress and line severity.
 *
 * Progress is only reported when the runtime actually prints it; there is no
 * synthetic estimate, so callers must handle `null` by showing an indeterminate
 * state rather than a fake percentage.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'plain';

/** Percent forms llama.cpp has used across builds. */
const PERCENT_PATTERNS = [
  /(?:load|loading)[^\n%]{0,40}?(\d{1,3}(?:\.\d+)?)\s*%/i,
  /progress\s*[:=]\s*(\d{1,3}(?:\.\d+)?)\s*%/i,
];
/** Fractional form: `progress = 0.0917`. */
const FRACTION_PATTERN = /progress\s*[:=]\s*(0?\.\d+|1\.0+)\b/i;

/**
 * Last load-progress percentage in a chunk of log text, or null when the
 * runtime reported none.
 */
export function parseLoadProgress(text: string): number | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    for (const pattern of PERCENT_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const value = Number.parseFloat(match[1]);
        if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
      }
    }
    const fraction = line.match(FRACTION_PATTERN);
    if (fraction) {
      const value = Number.parseFloat(fraction[1]) * 100;
      if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
    }
  }
  return null;
}

/** Coarse severity for log-line tinting. */
export function classifyLogLine(line: string): LogLevel {
  if (/\b(error|failed|fatal|panic|terminate called)\b/i.test(line)) return 'error';
  if (/\b(warn|warning|deprecated)\b/i.test(line)) return 'warn';
  if (/\b(debug|verbose|trace)\b/i.test(line)) return 'debug';
  if (/\b(info|loaded|listening|starting|server is)\b/i.test(line)) return 'info';
  return 'plain';
}

/**
 * Split a log blob into rendered lines, dropping a trailing partial write and
 * capping history so a long-running server cannot grow the DOM without bound.
 */
export function toLogLines(text: string, maxLines = 500): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
  return lines;
}

/**
 * Human phase for a starting serve, read from the tail of its log.
 * Falls back to a generic label when nothing recognisable has been printed.
 */
export function describeLoadPhase(text: string): string {
  if (!text) return 'Starting runtime';
  if (/server is listening|starting the main loop|HTTP server listening/i.test(text)) {
    return 'Warming up';
  }
  if (/load_tensors|loading model tensors|llama_model_loader/i.test(text)) {
    return 'Loading weights';
  }
  if (/llama_context|init: kv_size|KV self size/i.test(text)) return 'Allocating context';
  return 'Starting runtime';
}
