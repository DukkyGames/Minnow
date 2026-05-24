/**
 * Resolve reef artifact paths under ~/.minnow/reef/artifacts (not workspace).
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

const HOME_REEF_ARTIFACTS_REL = path.join('reef', 'artifacts');

/** Artifact id: lowercase slug, 1–64 chars. */
export const REEF_ARTIFACT_ID_RE = /^[a-z0-9-]{1,64}$/;

/** User-visible reef artifacts root under ~/.minnow. */
export function getHomeReefArtifactsDir() {
  return path.join(getMinnowHome(), HOME_REEF_ARTIFACTS_REL);
}

/**
 * @param {string} id
 */
export function isValidReefArtifactId(id) {
  return typeof id === 'string' && REEF_ARTIFACT_ID_RE.test(id);
}

/**
 * @param {string} id
 * @returns {string | null}
 */
function getCurrentVersionBodyPathSync(id) {
  const manifestPath = path.join(getHomeReefArtifactsDir(), id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const n = manifest?.currentVersion;
  if (!n) return null;
  const filePath = path.join(getHomeReefArtifactsDir(), id, `v${n}.md`);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

/**
 * True when absolute path is under ~/.minnow/reef/artifacts only.
 * @param {string} absPath
 */
export function isAllowedReefArtifactPath(absPath) {
  const resolved = path.resolve(absPath);
  const rootNorm = path.resolve(getHomeReefArtifactsDir());
  return resolved === rootNorm || resolved.startsWith(`${rootNorm}${path.sep}`);
}

/**
 * @param {string} userPath
 */
export function isReefArtifactPathAlias(userPath) {
  if (!userPath || typeof userPath !== 'string') return false;
  const norm = userPath.trim().replace(/\\/g, '/');
  if (norm.startsWith('@minnow/reef/artifacts')) return true;
  if (norm.startsWith('reef/artifacts/') || norm === 'reef/artifacts') return true;
  if (norm.includes('.minnow/reef/artifacts/')) return true;
  return false;
}

/**
 * Map tool paths for reef artifacts (home only, read/write).
 * Returns absolute path when recognized, otherwise null.
 *
 * Supported forms:
 * - @minnow/reef/artifacts/<id> → current version body
 * - @minnow/reef/artifacts/<id>/manifest.json
 * - @minnow/reef/artifacts/<id>/v<n>.md
 * - reef/artifacts/<id>/... (~/.minnow relative)
 * @param {string} userPath
 * @returns {string | null}
 */
export function tryResolveReefArtifactPath(userPath) {
  if (!userPath || typeof userPath !== 'string') return null;

  const trimmed = userPath.trim();
  const norm = trimmed.replace(/\\/g, '/');

  let rel = '';
  if (norm.startsWith('@minnow/reef/artifacts')) {
    rel = norm.slice('@minnow/reef/artifacts'.length).replace(/^\//, '');
  } else if (norm.startsWith('reef/artifacts/') || norm === 'reef/artifacts') {
    rel = norm.slice('reef/artifacts'.length).replace(/^\//, '');
  } else {
    const homePrefix = '.minnow/reef/artifacts/';
    if (!norm.includes(homePrefix)) return null;
    const idx = norm.indexOf(homePrefix);
    rel = norm.slice(idx + '.minnow/reef/artifacts/'.length);
  }

  if (!rel) {
    const root = getHomeReefArtifactsDir();
    return isAllowedReefArtifactPath(root) ? path.resolve(root) : null;
  }

  const segments = rel.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const id = segments[0];
  if (!isValidReefArtifactId(id)) return null;

  const artifactDir = path.join(getHomeReefArtifactsDir(), id);
  if (!isAllowedReefArtifactPath(artifactDir)) return null;

  if (segments.length === 1) {
    const current = getCurrentVersionBodyPathSync(id);
    return current && isAllowedReefArtifactPath(current) ? path.resolve(current) : null;
  }

  if (segments[1] === 'manifest.json') {
    const manifestPath = path.join(artifactDir, 'manifest.json');
    return isAllowedReefArtifactPath(manifestPath) ? path.resolve(manifestPath) : null;
  }

  const versionMatch = segments[1]?.match(/^v(\d+)\.md$/);
  if (versionMatch) {
    const versionPath = path.join(artifactDir, segments[1]);
    return isAllowedReefArtifactPath(versionPath) ? path.resolve(versionPath) : null;
  }

  return null;
}

/**
 * When find_files/grep search targets reef artifacts, redirect to home artifacts dir.
 * @param {string} pattern
 * @param {string} [searchPath]
 * @returns {string | null}
 */
export function tryResolveReefArtifactsFindRoot(pattern, searchPath = '.') {
  const normPattern = String(pattern ?? '').replace(/\\/g, '/');
  const normPath = String(searchPath ?? '.').replace(/\\/g, '/').trim();

  const looksLikeArtifactSearch =
    normPattern.includes('reef/artifacts') ||
    normPath.startsWith('@minnow/reef/artifacts') ||
    normPath.startsWith('reef/artifacts') ||
    normPath === 'reef/artifacts';

  if (!looksLikeArtifactSearch) return null;

  const dir = getHomeReefArtifactsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
