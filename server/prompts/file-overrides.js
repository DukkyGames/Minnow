/**
 * Read/write shipped prompt files and ~/.speedchat user overrides (modes, experts, sub-agents).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getSpeedChatHome } from '../config/home.js';
import { parsePromptMarkdown } from './parse.js';

const ENTITY_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * @param {string} id
 */
export function assertValidPromptEntityId(id) {
  if (!id || typeof id !== 'string' || !ENTITY_ID_RE.test(id)) {
    throw new Error('Invalid id');
  }
}

/**
 * @param {'modes'|'experts'|'sub-agents'} family
 * @param {string} entityId
 * @param {'full'|'lite'} profile
 */
function builtinRelativePath(family, entityId, profile) {
  if (family === 'modes') {
    return path.join('src', 'chat', 'prompts', 'modes', `${entityId}.${profile}.md`);
  }
  if (family === 'experts') {
    return path.join(
      'src',
      'chat',
      'prompts',
      'experts',
      entityId,
      `expert.${profile}.md`,
    );
  }
  return path.join('src', 'agents', 'prompts', 'sub-agents', `${entityId}.${profile}.md`);
}

/**
 * @param {'modes'|'experts'|'sub-agents'} family
 * @param {string} entityId
 * @param {'full'|'lite'} profile
 */
function userRelativePath(family, entityId, profile) {
  if (family === 'modes') {
    return path.join('prompts', 'modes', `${entityId}.${profile}.md`);
  }
  if (family === 'experts') {
    return path.join('prompts', 'experts', entityId, `expert.${profile}.md`);
  }
  return path.join('prompts', 'sub-agents', `${entityId}.${profile}.md`);
}

function resolveUnderRoot(root, rel) {
  const full = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error('Invalid path');
  }
  return full;
}

function extractBody(raw, filePath) {
  try {
    const parsed = parsePromptMarkdown(raw, filePath);
    return parsed.body.trim();
  } catch {
    return raw.trim();
  }
}

/**
 * @param {string} projectRoot
 * @param {'modes'|'experts'|'sub-agents'} family
 * @param {string} entityId
 * @param {'full'|'lite'} profile
 */
export async function readPromptFile(projectRoot, family, entityId, profile) {
  assertValidPromptEntityId(entityId);
  if (profile !== 'full' && profile !== 'lite') {
    throw new Error('Invalid profile');
  }

  const home = path.resolve(getSpeedChatHome());
  const userPath = resolveUnderRoot(home, userRelativePath(family, entityId, profile));

  try {
    const raw = await fs.readFile(userPath, 'utf8');
    return { content: extractBody(raw, userPath), source: 'override' };
  } catch {
    /* fall through */
  }

  const builtinPath = resolveUnderRoot(
    path.resolve(projectRoot),
    builtinRelativePath(family, entityId, profile),
  );
  const raw = await fs.readFile(builtinPath, 'utf8');
  return { content: extractBody(raw, builtinPath), source: 'builtin' };
}

/**
 * @param {'modes'|'experts'|'sub-agents'} family
 * @param {string} entityId
 * @param {'full'|'lite'} profile
 * @param {string} content
 */
export async function writePromptFileOverride(family, entityId, profile, content) {
  assertValidPromptEntityId(entityId);
  if (profile !== 'full' && profile !== 'lite') {
    throw new Error('Invalid profile');
  }

  const home = path.resolve(getSpeedChatHome());
  const filePath = resolveUnderRoot(home, userRelativePath(family, entityId, profile));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body =
    typeof content === 'string' && content.trim() ? `${content.trim()}\n` : '';
  await fs.writeFile(filePath, body, 'utf8');
  return filePath;
}

/**
 * Remove user override so built-in ships again.
 */
export async function deletePromptFileOverride(family, entityId, profile) {
  assertValidPromptEntityId(entityId);
  const home = path.resolve(getSpeedChatHome());
  const filePath = resolveUnderRoot(home, userRelativePath(family, entityId, profile));
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
