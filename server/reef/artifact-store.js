/**
 * Versioned reef artifacts under ~/.minnow/reef/artifacts/<id>/.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  getHomeReefArtifactsDir,
  isValidReefArtifactId,
  isAllowedReefArtifactPath,
} from './artifact-paths.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * @param {string} id
 */
function artifactDirFor(id) {
  return path.join(getHomeReefArtifactsDir(), id);
}

/**
 * @param {number} version
 */
function versionFileName(version) {
  return `v${version}.md`;
}

/**
 * @param {Record<string, unknown>} meta
 * @param {string} body
 */
export function formatVersionMarkdown(meta, body) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('---', '', body);
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string} raw
 * @returns {{ meta: Record<string, string>; body: string }}
 */
export function parseVersionMarkdown(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { meta: {}, body: raw };
  }
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body: match[2] };
}

/**
 * @param {string} id
 */
export async function getArtifactManifest(id) {
  if (!isValidReefArtifactId(id)) return null;
  const manifestPath = path.join(artifactDirFor(id), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const raw = await fsp.readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * @param {string} id
 * @returns {Promise<string | null>} absolute path to current version body file
 */
export async function getCurrentVersionBodyPath(id) {
  const manifest = await getArtifactManifest(id);
  if (!manifest?.currentVersion) return null;
  const filePath = path.join(artifactDirFor(id), versionFileName(manifest.currentVersion));
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

/**
 * @param {string} [title]
 */
function slugFromTitle(title) {
  const base = String(title ?? 'artifact')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'artifact';
}

/**
 * @param {object} opts
 * @param {string} [opts.id]
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.author]
 * @param {string[]} [opts.refs]
 * @param {object} [opts.source]
 * @param {string[]} [opts.chatIds]
 */
export async function createArtifact(opts) {
  const now = new Date().toISOString();
  let id = opts.id?.trim();
  if (id && !isValidReefArtifactId(id)) {
    throw new Error('Invalid artifact id');
  }
  if (!id) {
    const suffix = '00000000';
    id = `${slugFromTitle(opts.title)}-${suffix}`.slice(0, 64);
    let n = 0;
    while (fs.existsSync(artifactDirFor(id))) {
      n += 1;
      id = `${slugFromTitle(opts.title)}-${suffix}-${n}`.slice(0, 64);
    }
  }

  const dir = artifactDirFor(id);
  if (fs.existsSync(dir)) {
    throw new Error(`Artifact already exists: ${id}`);
  }
  await fsp.mkdir(dir, { recursive: true });

  const manifest = {
    id,
    title: opts.title || id,
    currentVersion: 1,
    refs: Array.isArray(opts.refs) ? opts.refs.filter(isValidReefArtifactId) : [],
    chatIds: Array.isArray(opts.chatIds) ? opts.chatIds : [],
    widgetBindings: [],
    createdAt: now,
    updatedAt: now,
    ...(opts.source ? { source: opts.source } : {}),
  };

  const author = opts.author || 'agent';
  const versionMd = formatVersionMarkdown(
    { version: 1, author, parentVersion: 0 },
    opts.body ?? '',
  );

  await fsp.writeFile(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fsp.writeFile(path.join(dir, versionFileName(1)), versionMd, 'utf8');

  return { manifest, body: opts.body ?? '' };
}

/**
 * @param {string} id
 * @param {object} opts
 * @param {string} opts.body
 * @param {string} [opts.author]
 * @param {string[]} [opts.refs]
 * @param {string} [opts.summary]
 * @param {number} [opts.expectedVersion] parent version for optimistic concurrency
 */
export async function appendArtifactVersion(id, opts) {
  if (!isValidReefArtifactId(id)) {
    throw new Error('Invalid artifact id');
  }

  const dir = artifactDirFor(id);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Artifact not found: ${id}`);
  }

  const manifest = await getArtifactManifest(id);
  if (!manifest) {
    throw new Error(`Artifact not found: ${id}`);
  }

  if (
    opts.expectedVersion != null &&
    Number(opts.expectedVersion) !== Number(manifest.currentVersion)
  ) {
    const err = new Error('Version conflict');
    err.code = 'VERSION_CONFLICT';
    err.currentVersion = manifest.currentVersion;
    throw err;
  }

  const nextVersion = Number(manifest.currentVersion) + 1;
  const author = opts.author || 'user';
  const versionMd = formatVersionMarkdown(
    {
      version: nextVersion,
      author,
      parentVersion: manifest.currentVersion,
      ...(opts.summary ? { summary: opts.summary } : {}),
    },
    opts.body ?? '',
  );

  manifest.currentVersion = nextVersion;
  manifest.updatedAt = new Date().toISOString();
  if (Array.isArray(opts.refs)) {
    manifest.refs = opts.refs.filter(isValidReefArtifactId);
  }

  await fsp.writeFile(path.join(dir, versionFileName(nextVersion)), versionMd, 'utf8');
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    manifest,
    version: nextVersion,
    path: path.join(dir, versionFileName(nextVersion)),
  };
}

/**
 * @param {string} id
 * @param {number} version
 */
export async function readArtifactVersion(id, version) {
  const manifest = await getArtifactManifest(id);
  if (!manifest) return null;

  const n = version ?? manifest.currentVersion;
  const filePath = path.join(artifactDirFor(id), versionFileName(n));
  if (!isAllowedReefArtifactPath(filePath) || !fs.existsSync(filePath)) {
    return null;
  }

  const raw = await fsp.readFile(filePath, 'utf8');
  const { meta, body } = parseVersionMarkdown(raw);
  return { manifest, version: n, meta, body, raw };
}

/**
 * @param {string} id
 */
export async function getArtifactWithCurrentBody(id) {
  const manifest = await getArtifactManifest(id);
  if (!manifest) return null;
  const current = await readArtifactVersion(id, manifest.currentVersion);
  return current;
}

/**
 * List artifact manifests (newest updatedAt first).
 * @param {{ limit?: number; offset?: number }} [opts]
 */
export async function listArtifacts(opts = {}) {
  const root = getHomeReefArtifactsDir();
  if (!fs.existsSync(root)) {
    await fsp.mkdir(root, { recursive: true });
    return [];
  }

  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const entries = await fsp.readdir(root, { withFileTypes: true });
  const manifests = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (!isValidReefArtifactId(ent.name)) continue;
    const manifest = await getArtifactManifest(ent.name);
    if (manifest) manifests.push(manifest);
  }

  manifests.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return manifests.slice(offset, offset + limit);
}

/**
 * save_file on an artifact alias appends a new version instead of overwriting.
 * @param {string} absPath
 * @param {string} content
 * @param {string} [author]
 */
export async function appendArtifactVersionFromSave(absPath, content, author = 'agent') {
  const resolved = path.resolve(absPath);
  const root = path.resolve(getHomeReefArtifactsDir());
  const rel = path.relative(root, resolved).replace(/\\/g, '/');
  const segments = rel.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('Cannot save artifact root directly');
  }

  const id = segments[0];
  const file = segments[1];

  if (file === 'manifest.json') {
    throw new Error('manifest.json is read-only; update via artifact API');
  }

  const versionMatch = file.match(/^v(\d+)\.md$/);
  if (versionMatch) {
    return appendArtifactVersion(id, { body: content, author });
  }

  throw new Error('Unrecognized artifact path');
}
