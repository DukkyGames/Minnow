/**
 * Resolve reef widget template paths against Minnow install / ~/.minnow,
 * not the user's workspace root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { getAppRoot } from '../workspace/root.js';

const REEF_WIDGETS_REL = path.join('src', 'chat', 'reef', 'widgets');
const HOME_REEF_WIDGETS_REL = path.join('reef', 'widgets');

/** Built-in widget templates shipped in the repo. */
export function getBuiltinReefWidgetsDir() {
  return path.join(getAppRoot(), REEF_WIDGETS_REL);
}

/** User-visible copy under ~/.minnow (synced from built-ins). */
export function getHomeReefWidgetsDir() {
  return path.join(getMinnowHome(), HOME_REEF_WIDGETS_REL);
}

/**
 * Prefer home copy when present; otherwise built-in install dir.
 * @returns {string | null}
 */
export function resolveReefWidgetsSearchDir() {
  const home = getHomeReefWidgetsDir();
  if (fs.existsSync(home)) return home;
  const builtin = getBuiltinReefWidgetsDir();
  if (fs.existsSync(builtin)) return builtin;
  return null;
}

/**
 * True when absolute path is under built-in or ~/.minnow reef widget dirs.
 * @param {string} absPath
 */
export function isAllowedReefWidgetReadPath(absPath) {
  const resolved = path.resolve(absPath);
  const roots = [getBuiltinReefWidgetsDir(), getHomeReefWidgetsDir()];
  for (const root of roots) {
    const rootNorm = path.resolve(root);
    if (resolved === rootNorm || resolved.startsWith(`${rootNorm}${path.sep}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Map tool paths that refer to Minnow reef templates (not the workspace).
 * Returns absolute path when recognized, otherwise null.
 *
 * Supported forms:
 * - @minnow/reef/widgets/calculator.md
 * - src/chat/reef/widgets/calculator.md (repo-relative install path)
 * - reef/widgets/calculator.md (~/.minnow relative)
 * @param {string} userPath
 * @returns {string | null}
 */
export function tryResolveReefWidgetReadPath(userPath) {
  if (!userPath || typeof userPath !== 'string') return null;

  const trimmed = userPath.trim();
  const norm = trimmed.replace(/\\/g, '/');

  if (norm.startsWith('@minnow/reef/widgets')) {
    const sub = norm.slice('@minnow/reef/widgets'.length).replace(/^\//, '');
    const candidate = sub
      ? path.join(getBuiltinReefWidgetsDir(), sub)
      : getBuiltinReefWidgetsDir();
    if (fs.existsSync(candidate) || isAllowedReefWidgetReadPath(candidate)) {
      return path.resolve(candidate);
    }
    const homeCandidate = sub
      ? path.join(getHomeReefWidgetsDir(), sub)
      : getHomeReefWidgetsDir();
    if (isAllowedReefWidgetReadPath(homeCandidate)) return path.resolve(homeCandidate);
    return null;
  }

  if (norm.startsWith('@minnow/')) {
    const rel = norm.slice('@minnow/'.length);
    const candidate = path.join(getAppRoot(), rel);
    if (isAllowedReefWidgetReadPath(candidate)) return path.resolve(candidate);
    return null;
  }

  const builtinMarker = 'src/chat/reef/widgets/';
  if (norm.startsWith(builtinMarker) || norm.includes(`/${builtinMarker}`)) {
    const idx = norm.indexOf(builtinMarker);
    const rel = norm.slice(idx);
    const candidate = path.join(getAppRoot(), rel);
    if (fs.existsSync(candidate) || isAllowedReefWidgetReadPath(candidate)) {
      return path.resolve(candidate);
    }
  }

  if (norm.startsWith('reef/widgets/')) {
    const candidate = path.join(getMinnowHome(), norm);
    if (isAllowedReefWidgetReadPath(candidate)) return path.resolve(candidate);
  }

  const homePrefix = '.minnow/reef/widgets/';
  if (norm.includes(homePrefix)) {
    const idx = norm.indexOf(homePrefix);
    const rel = norm.slice(idx + '.minnow/'.length);
    const candidate = path.join(getMinnowHome(), rel);
    if (isAllowedReefWidgetReadPath(candidate)) return path.resolve(candidate);
  }

  return null;
}

/**
 * When find_files/grep search for reef templates under ".", redirect to install dir.
 * @param {string} pattern
 * @param {string} [searchPath]
 * @returns {string | null} absolute directory to search
 */
export function tryResolveReefWidgetsFindRoot(pattern, searchPath = '.') {
  const normPattern = String(pattern ?? '').replace(/\\/g, '/');
  const normPath = String(searchPath ?? '.').replace(/\\/g, '/').trim();

  const looksLikeReefTemplateSearch =
    normPattern.includes('reef/widgets') ||
    normPattern.startsWith('src/chat/reef/') ||
    normPath.startsWith('@minnow/reef/widgets') ||
    normPath.startsWith('src/chat/reef/widgets') ||
    normPath === 'reef/widgets';

  if (!looksLikeReefTemplateSearch) return null;

  if (normPath.startsWith('@minnow/')) {
    const resolved = tryResolveReefWidgetReadPath(normPath);
    if (resolved) {
      const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
      return stat?.isDirectory() ? resolved : path.dirname(resolved);
    }
  }

  const dir = resolveReefWidgetsSearchDir();
  return dir ?? null;
}
