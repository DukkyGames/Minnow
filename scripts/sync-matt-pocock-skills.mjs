
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMinnowPatchesToSkillDir,
} from './matt-pocock-preserves/apply-minnow-patches.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const STRICT = process.env.MATT_POCOCK_SKILLS_SYNC_STRICT === '1';
const SKILLS_ROOT = path.resolve(
  PROJECT_ROOT,
  process.env.MATT_POCOCK_SKILLS_TARGET || '.cache/matt-pocock-skills',
);
const LOCK_FILE = path.join(PROJECT_ROOT, 'skills-lock.json');
const CATALOG_FILE = path.join(
  __dirname,
  'matt-pocock-preserves',
  'skill-catalog.json',
);

const GITHUB_USER_AGENT = 'minnow-matt-pocock-skills-sync';

/**
 * @param {string} message
 */
function warn(message) {
  console.warn(`[matt-pocock:sync] ${message}`);
}

/**
 * @param {string} message
 */
function fail(message) {
  if (STRICT) {
    console.error(`[matt-pocock:sync] ${message}`);
    process.exit(1);
  }
  warn(`${message} (non-strict; set MATT_POCOCK_SKILLS_SYNC_STRICT=1 to fail CI)`);
}

/**
 * @param {string} ref
 * @returns {Promise<string>}
 */
async function resolveCommitSha(ref) {
  const res = await fetch(
    `https://api.github.com/repos/mattpocock/skills/commits/${encodeURIComponent(ref)}`,
    { headers: { 'User-Agent': GITHUB_USER_AGENT } },
  );
  if (res.ok) {
    const data = await res.json();
    if (data.sha && typeof data.sha === 'string') return data.sha;
  }

  if (fs.existsSync(LOCK_FILE)) {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    const pinned = lock['matt-pocock-skills']?.commitSha;
    if (typeof pinned === 'string' && /^[0-9a-f]{40}$/.test(pinned)) {
      warn(
        `GitHub API unavailable (${res.status}); using pinned commit ${pinned.slice(0, 7)} from skills-lock.json`,
      );
      return pinned;
    }
  }

  throw new Error(`Failed to resolve ref "${ref}" (${res.status})`);
}

/**
 * @param {string} apiPath repo-relative path
 * @param {string} sha
 * @returns {Promise<Array<{ name: string, path: string, type: string, download_url?: string }>>}
 */
async function listGithubContents(apiPath, sha) {
  const url = `https://api.github.com/repos/mattpocock/skills/contents/${apiPath}?ref=${sha}`;
  const res = await fetch(url, { headers: { 'User-Agent': GITHUB_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`GitHub contents failed for ${apiPath} (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

/**
 * @param {{ category: string, upstreamId: string, extraFiles?: string[] }} entry
 * @returns {string[]}
 */
function catalogRelativePaths(entry) {
  const paths = ['SKILL.md'];
  for (const file of entry.extraFiles ?? []) {
    paths.push(file);
  }
  return paths;
}

/**
 * @param {string} upstreamPath
 * @param {string} sha
 * @param {{ category: string, upstreamId: string, extraFiles?: string[] }} entry
 * @returns {Promise<Array<{ relPath: string, downloadUrl: string }>>}
 */
async function resolveUpstreamFiles(upstreamPath, sha, entry) {
  try {
    return await collectUpstreamFiles(upstreamPath, sha);
  } catch (err) {
    warn(
      `GitHub API listing failed for ${upstreamPath}: ${err instanceof Error ? err.message : String(err)}; using catalog file list`,
    );
    return catalogRelativePaths(entry).map((relPath) => ({
      relPath,
      downloadUrl: `https://raw.githubusercontent.com/mattpocock/skills/${sha}/${upstreamPath}/${relPath}`,
    }));
  }
}

/**
 * @param {string} apiPath
 * @param {string} sha
 * @returns {Promise<Array<{ relPath: string, downloadUrl: string }>>}
 */
async function collectUpstreamFiles(apiPath, sha) {
/** @type {Array<{ relPath: string, downloadUrl: string }>} */
  const files = [];
  const entries = await listGithubContents(apiPath, sha);

  for (const entry of entries) {
    if (entry.type === 'file' && entry.download_url) {
      const relPath = entry.path.slice(apiPath.length + 1);
      files.push({ relPath, downloadUrl: entry.download_url });
      continue;
    }
    if (entry.type === 'dir') {
      const nested = await collectUpstreamFiles(entry.path, sha);
      files.push(...nested);
    }
  }

  return files;
}

/**
 * @param {string} downloadUrl
 * @param {string} sha
 * @param {string} repoPath
 * @returns {Promise<Buffer>}
 */
async function fetchFileBuffer(downloadUrl, sha, repoPath) {
  const res = await fetch(downloadUrl, { headers: { 'User-Agent': GITHUB_USER_AGENT } });
  if (res.ok) {
    return Buffer.from(await res.arrayBuffer());
  }

  const rawUrl = `https://raw.githubusercontent.com/mattpocock/skills/${sha}/${repoPath}`;
  const rawRes = await fetch(rawUrl, { headers: { 'User-Agent': GITHUB_USER_AGENT } });
  if (!rawRes.ok) {
    throw new Error(`Download failed (${res.status}/${rawRes.status}): ${repoPath}`);
  }
  return Buffer.from(await rawRes.arrayBuffer());
}

/**
 * @param {string} filePath
 * @param {Buffer} data
 */
function writeFileEnsuringDir(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

/**
 * @param {string} content
 * @returns {string}
 */
function sha256Hex(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * @param {string} skillDir
 * @returns {Record<string, string>}
 */
function hashSkillTree(skillDir) {
/** @type {Record<string, string>} */
  const hashes = {};

/** @param {string} dir */
/** @param {string} prefix */
  function walk(dir, prefix) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (name === 'SKILL.upstream.md') continue;
      const buf = fs.readFileSync(full);
      hashes[rel.replace(/\\/g, '/')] = sha256Hex(buf);
    }
  }

  if (fs.existsSync(skillDir)) {
    walk(skillDir, '');
  }

  return hashes;
}

/**
 * @param {Record<string, string>} fileHashes
 * @param {string} commitSha
 * @param {string} ref
 */
function updateLockFile(fileHashes, commitSha, ref) {
/** @type {Record<string, unknown>} */
  let lock = { version: 1, skills: {} };
  if (fs.existsSync(LOCK_FILE)) {
    lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  }
  if (!lock.skills || typeof lock.skills !== 'object') {
    lock.skills = {};
  }

  lock['matt-pocock-skills'] = {
    source: 'mattpocock/skills',
    ref,
    commitSha,
    syncedAt: new Date().toISOString(),
    skills: fileHashes,
  };

  fs.writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

/**
 * @param {{ skills: Array<{ category: string, upstreamId: string, id: string }> }} catalog
 * @param {string} sha
 */
async function syncAllSkills(catalog, sha) {
/** @type {Record<string, Record<string, string>>} */
  const allHashes = {};

  for (const entry of catalog.skills) {
    const upstreamPath = `skills/${entry.category}/${entry.upstreamId}`;
    const targetDir = path.join(SKILLS_ROOT, entry.id);

    const files = await resolveUpstreamFiles(upstreamPath, sha, entry);
    if (files.length === 0) {
      fail(`No files found for ${upstreamPath}`);
      continue;
    }

/** @type {Array<{ relPath: string, buf: Buffer }>} */
    const staged = [];
    for (const file of files) {
      const repoPath = `${upstreamPath}/${file.relPath}`;
      const buf = await fetchFileBuffer(file.downloadUrl, sha, repoPath);
      staged.push({ relPath: file.relPath, buf });
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });

    for (const file of staged) {
      const dest = path.join(targetDir, file.relPath);
      writeFileEnsuringDir(dest, file.buf);

      if (file.relPath === 'SKILL.md') {
        const upstreamCopy = path.join(targetDir, 'SKILL.upstream.md');
        const header =
          '<!-- AUTO-SYNCED from mattpocock/skills upstream — do not edit; run npm run matt-pocock-skills:sync -->\n\n';
        fs.writeFileSync(upstreamCopy, header + file.buf.toString('utf8').trim() + '\n', 'utf8');
      }
    }

    applyMinnowPatchesToSkillDir(targetDir, entry);
    allHashes[entry.id] = hashSkillTree(targetDir);

    console.log(
      `[matt-pocock:sync] ${entry.id} ← ${upstreamPath} (${files.length} files)`,
    );
  }

  return allHashes;
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  const ref = process.env.MATT_POCOCK_SKILLS_REF || catalog.defaultRef || 'main';

  let sha;
  try {
    sha = await resolveCommitSha(ref);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  let allHashes;
  try {
    allHashes = await syncAllSkills(catalog, sha);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  updateLockFile(allHashes, sha, ref);
  console.log(
    `[matt-pocock:sync] Done — ${catalog.skills.length} skills @ ${sha.slice(0, 7)}`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
