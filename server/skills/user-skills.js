/**
 * Create and update user skills under ~/.minnow/skills/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultSkillLabel, parseSkillFrontmatter } from './parse-frontmatter.js';
import { getBuiltinSkillsRoot, getUserSkillsRoot, SKILL_ID_RE } from './scan.js';

/**
 * @param {string} projectRoot
 * @returns {Promise<string>}
 */
async function readSkillTemplate(projectRoot) {
  const templatePath = path.join(getBuiltinSkillsRoot(projectRoot), '_template', 'SKILL.md');
  return fs.readFile(templatePath, 'utf8');
}

/**
 * @param {string} template
 * @param {string} id
 * @param {string} label
 */
function applyTemplateIds(template, id, label) {
  return template
    .replace(/^name:\s*.+$/m, `name: ${id}`)
    .replace(/^label:\s*.+$/m, `label: ${label}`);
}

/**
 * @param {string} projectRoot
 * @param {string} id
 * @param {string} [label]
 * @returns {Promise<{ path: string }>}
 */
export async function createUserSkill(projectRoot, id, label) {
  if (!SKILL_ID_RE.test(id) || id.startsWith('_')) {
    throw new Error('Invalid skill id (use lowercase letters, numbers, hyphens)');
  }

  const userRoot = getUserSkillsRoot();
  await fs.mkdir(userRoot, { recursive: true });

  const skillDir = path.join(userRoot, id);
  const skillPath = path.join(skillDir, 'SKILL.md');

  try {
    await fs.access(skillPath);
    throw new Error(`Skill "${id}" already exists`);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
      throw err;
    }
  }

  const displayLabel = label?.trim() || defaultSkillLabel(id);
  const template = await readSkillTemplate(projectRoot);
  const raw = applyTemplateIds(template, id, displayLabel);
  parseSkillFrontmatter(raw);

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillPath, raw, 'utf8');

  return { path: skillPath };
}

/**
 * @param {string} id
 * @param {string} content
 * @returns {Promise<{ path: string }>}
 */
export async function saveUserSkillContent(id, content) {
  if (!SKILL_ID_RE.test(id) || id.startsWith('_')) {
    throw new Error('Invalid skill id');
  }

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('SKILL.md content is required');
  }

  const { meta } = parseSkillFrontmatter(content);
  if (meta.name.trim() !== id) {
    throw new Error(`Front matter "name" must match skill id "${id}"`);
  }

  const userRoot = getUserSkillsRoot();
  const skillDir = path.join(userRoot, id);
  const skillPath = path.join(skillDir, 'SKILL.md');

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillPath, content, 'utf8');

  return { path: skillPath };
}
