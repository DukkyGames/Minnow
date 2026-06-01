/**
 * Parse workspace-root startup.md YAML frontmatter (minimal subset).
 */

import path from 'node:path';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a simple `key: value` line (strips optional quotes).
 * @param {string} line
 * @returns {{ key: string, value: string } | null}
 */
function parseScalarLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const colon = trimmed.indexOf(':');
  if (colon <= 0) return null;
  const key = trimmed.slice(0, colon).trim();
  let value = trimmed.slice(colon + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * @param {string} yamlText
 * @returns {Record<string, unknown>}
 */
function parseFrontmatterYaml(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  /** @type {Record<string, unknown>} */
  const out = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const scalar = parseScalarLine(line);
    if (!scalar) {
      i += 1;
      continue;
    }

    if (scalar.key === 'stop' && scalar.value === '') {
      /** @type {Record<string, string>} */
      const stop = {};
      i += 1;
      while (i < lines.length) {
        const nested = lines[i];
        if (!nested.startsWith('  ') && nested.trim() !== '') break;
        const nestedScalar = parseScalarLine(nested.trim());
        if (nestedScalar) stop[nestedScalar.key] = nestedScalar.value;
        i += 1;
      }
      if (Object.keys(stop).length > 0) out.stop = stop;
      continue;
    }

    out[scalar.key] = scalar.value;
    i += 1;
  }

  return out;
}

/**
 * @typedef {object} StartupGuide
 * @property {string} command
 * @property {string} [cwd]
 * @property {string} [healthUrl]
 * @property {number} [port]
 * @property {{ command?: string }} [stop]
 */

/**
 * Coerce parsed frontmatter into a startup guide.
 * @param {Record<string, unknown>} raw
 * @returns {StartupGuide | null}
 */
export function coerceStartupGuide(raw) {
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) return null;

  /** @type {StartupGuide} */
  const guide = { command };

  if (typeof raw.cwd === 'string' && raw.cwd.trim()) {
    guide.cwd = raw.cwd.trim();
  }
  if (typeof raw.healthUrl === 'string' && raw.healthUrl.trim()) {
    guide.healthUrl = raw.healthUrl.trim();
  }
  if (typeof raw.port === 'number' && Number.isFinite(raw.port)) {
    guide.port = raw.port;
  } else if (typeof raw.port === 'string' && raw.port.trim()) {
    const n = Number(raw.port);
    if (Number.isFinite(n)) guide.port = n;
  }

  if (raw.stop && typeof raw.stop === 'object') {
    const stopRow = /** @type {Record<string, unknown>} */ (raw.stop);
    const stopCmd =
      typeof stopRow.command === 'string' ? stopRow.command.trim() : '';
    if (stopCmd) guide.stop = { command: stopCmd };
  }

  return guide;
}

/**
 * @param {string} content Full file contents
 * @returns {{ guide: StartupGuide | null, body: string, error?: string }}
 */
export function parseStartupMarkdown(content) {
  const text = typeof content === 'string' ? content : '';
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    return {
      guide: null,
      body: text,
      error: 'startup.md must begin with YAML frontmatter (---)',
    };
  }

  const raw = parseFrontmatterYaml(match[1]);
  const guide = coerceStartupGuide(raw);
  if (!guide) {
    return {
      guide: null,
      body: match[2] ?? '',
      error: 'startup.md frontmatter requires command:',
    };
  }

  return { guide, body: match[2] ?? '' };
}

/**
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function startupFilePath(workspaceRoot) {
  return path.join(workspaceRoot, 'startup.md');
}
