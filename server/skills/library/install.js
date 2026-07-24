/**
 * Skills Library install flow — fetch, write, provenance, enable (MIN-475).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfigJson, writeConfigJson } from '../../config/store.js';
import { normalizeSkillConfig } from '../../config/validators.js';
import { parseSkillFrontmatter } from '../parse-frontmatter.js';
import { getUserSkillsRoot, SKILL_ID_RE } from '../scan.js';
import {
  fetchSkillDirectoryFiles,
  parseGitHubRepoUrl,
  resolveCommitSha,
} from './github-fetch.js';
import { recordProvenance, removeProvenanceEntry } from './provenance.js';
import { runPostInstallPatch } from './post-install.js';

/**
 * @param {Array<{ relPath: string, content: string }>} files
 * @returns {string}
 */
export function computeSkillSha256(files) {
  const hash = createHash('sha256');
  const sorted = [...files].sort((a, b) => a.relPath.localeCompare(b.relPath));
  for (const file of sorted) {
    hash.update(file.relPath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * @param {string} skillId
 */
export async function enableSkill(skillId) {
  const raw = (await readConfigJson('skills.json')) ?? { enabled: {} };
  const config = normalizeSkillConfig(raw);
  config.enabled[skillId] = true;
  await writeConfigJson('skills.json', config);
}

/**
 * @param {string} skillId
 * @param {Array<{ relPath: string, content: string }>} files
 */
export async function writeSkillFiles(skillId, files) {
  if (!SKILL_ID_RE.test(skillId) || skillId.startsWith('_')) {
    throw new Error(`Invalid skill id "${skillId}"`);
  }

  const skillDir = path.join(getUserSkillsRoot(), skillId);
  await fs.mkdir(skillDir, { recursive: true });

  for (const file of files) {
    const rel = file.relPath.replace(/^\/+/, '');
    if (!rel || rel.includes('..')) {
      throw new Error(`Unsafe skill file path: ${file.relPath}`);
    }
    const dest = path.join(skillDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.content, 'utf8');
  }

  return skillDir;
}

/**
 * @param {Array<{ relPath: string, content: string }>} files
 * @returns {string}
 */
export function resolveSkillIdFromFiles(files) {
  const skillMd = files.find((file) => file.relPath === 'SKILL.md' || file.relPath.endsWith('/SKILL.md'));
  if (!skillMd) {
    throw new Error('SKILL.md is required');
  }

  const { meta } = parseSkillFrontmatter(skillMd.content);
  const id = meta.name.trim();
  if (!SKILL_ID_RE.test(id) || id.startsWith('_')) {
    throw new Error(`Invalid skill id in SKILL.md front matter: "${id}"`);
  }
  return id;
}

/**
 * @param {{
 *   skillId: string,
 *   repo: string,
 *   commit: string,
 *   subpath: string,
 *   pack?: string,
 *   postInstallPatch?: string,
 *   files: Array<{ relPath: string, content: string }>,
 * }} options
 * @returns {Promise<{ skillId: string, path: string, sha256: string }>}
 */
export async function installSkillTree(options) {
  const { skillId, repo, commit, subpath, pack, postInstallPatch, files } = options;
  const resolvedId = resolveSkillIdFromFiles(files);
  if (!postInstallPatch && resolvedId !== skillId) {
    throw new Error(`Skill id mismatch: index says "${skillId}" but SKILL.md name is "${resolvedId}"`);
  }

  const skillDir = await writeSkillFiles(skillId, files);

  if (postInstallPatch) {
    await runPostInstallPatch(postInstallPatch, skillDir, { skillId, subpath });
    const patchedSkillMd = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    const { meta } = parseSkillFrontmatter(patchedSkillMd);
    const patchedId = meta.name.trim();
    if (patchedId !== skillId) {
      throw new Error(
        `Post-install patch "${postInstallPatch}" left SKILL.md name "${patchedId}" (expected "${skillId}")`,
      );
    }
  } else if (resolvedId !== skillId) {
    throw new Error(`Skill id mismatch: index says "${skillId}" but SKILL.md name is "${resolvedId}"`);
  }

  const sha256 = computeSkillSha256(files);
  await recordProvenance(skillId, {
    pack,
    repo,
    commit,
    subpath,
    installedAt: new Date().toISOString(),
    sha256,
  });
  await enableSkill(skillId);

  return { skillId, path: skillDir, sha256 };
}

/**
 * @param {import('../../../src/skills/library/registry.ts').SkillsLibraryPack} pack
 * @param {import('../../../src/skills/library/registry.ts').SkillsLibraryIndexSkill} indexSkill
 * @param {typeof fetch} [fetchImpl]
 */
export async function installPackSkill(pack, indexSkill, fetchImpl = fetch) {
  const { repo, commit } = pack.source;
  const files = await fetchSkillDirectoryFiles(repo, commit, indexSkill.subpath, fetchImpl);
  return installSkillTree({
    skillId: indexSkill.skillId,
    repo,
    commit,
    subpath: indexSkill.subpath,
    pack: pack.id,
    postInstallPatch: pack.postInstallPatch,
    files,
  });
}

/**
 * @param {string} repoUrl
 * @param {string} [subpathOverride]
 * @param {typeof fetch} [fetchImpl]
 */
export async function installSkillFromRepoUrl(repoUrl, subpathOverride, fetchImpl = fetch) {
  const parsed = parseGitHubRepoUrl(repoUrl);
  const subpath = (subpathOverride ?? parsed.subpath).replace(/^\/+|\/+$/g, '');
  const ref = parsed.ref ?? 'HEAD';
  const commit = await resolveCommitSha(parsed.repo, ref, fetchImpl);
  const files = await fetchSkillDirectoryFiles(parsed.repo, commit, subpath, fetchImpl);
  const skillId = resolveSkillIdFromFiles(files);

  return installSkillTree({
    skillId,
    repo: parsed.repo,
    commit,
    subpath,
    files,
  });
}

/**
 * @param {string} skillId
 */
export async function removeInstalledSkill(skillId) {
  if (!SKILL_ID_RE.test(skillId) || skillId.startsWith('_')) {
    throw new Error('Invalid skill id');
  }

  const removed = await removeProvenanceEntry(skillId);
  if (!removed) {
    throw new Error(`Skill "${skillId}" is not tracked as a library install`);
  }

  const skillDir = path.join(getUserSkillsRoot(), skillId);
  await fs.rm(skillDir, { recursive: true, force: true });
  return { skillId, removed: true };
}
