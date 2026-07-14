/**
 * Local model cache scan — HF hub, Minnow artifacts, Ollama, custom dirs.
 * Ports Odysseus cookbook_helpers._cached_model_scan_script to Node.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getModelsConfig } from './models-config.js';
import { getModelsRoot, repoDownloadDir } from './paths.js';
import { scanInstalledArtifacts } from './installed.js';

/** Paths that must never be walked (safety). */
const BLOCKED_ROOTS = ['/sys', '/proc', '/dev', '/run', '/var/run'];

/**
 * @typedef {object} CachedGgufFile
 * @property {string} name
 * @property {string} rel_path
 * @property {number} size_bytes
 * @property {string} role
 * @property {string} quant
 * @property {boolean} [split]
 * @property {number} [parts]
 */

/**
 * @typedef {object} CachedModelRow
 * @property {string} repo_id
 * @property {number} size_bytes
 * @property {number} nb_files
 * @property {boolean} has_incomplete
 * @property {string} path
 * @property {boolean} [is_gguf]
 * @property {boolean} [is_ollama]
 * @property {boolean} [is_local_dir]
 * @property {boolean} [is_diffusion]
 * @property {string} [backend]
 * @property {CachedGgufFile[]} [gguf_files]
 * @property {string} [status]
 */

/**
 * @param {string} p
 */
function safePath(p) {
  try {
    const rp = path.resolve(p);
    return !BLOCKED_ROOTS.some((b) => rp === b || rp.startsWith(`${b}${path.sep}`));
  } catch {
    return false;
  }
}

/**
 * HuggingFace hub cache directory candidates.
 * @returns {string[]}
 */
export function hfCachePaths() {
  const candidates = [];
  const add = (p) => {
    if (!p) return;
    const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
    if (!candidates.includes(expanded)) candidates.push(expanded);
  };

  add(process.env.HUGGINGFACE_HUB_CACHE);
  const hfHome = process.env.HF_HOME;
  if (hfHome) add(path.join(hfHome, 'hub'));
  add(path.join(os.homedir(), '.cache', 'huggingface', 'hub'));
  if (process.platform === 'win32') {
    add(path.join(os.homedir(), '.cache', 'huggingface', 'hub'));
  }
  return candidates;
}

/**
 * Extract quant tier from a GGUF filename.
 * @param {string} name
 */
function ggufQuant(name) {
  const m = name.match(/(?:UD-)?(IQ\d+_[A-Z0-9_]+|Q\d(?:_[A-Z0-9]+)+|BF16|F16|FP16|F32|Q8_0)/i);
  return m ? m[0].toUpperCase() : '';
}

/**
 * Classify GGUF role (model vs projector).
 * @param {string} name
 */
function ggufRole(name) {
  const n = name.toLowerCase();
  if (n.startsWith('mmproj') || n.includes('mmproj')) return 'projector';
  return 'model';
}

/**
 * Collect GGUF files under a directory tree.
 * @param {string} base
 * @returns {Promise<CachedGgufFile[]>}
 */
async function collectGgufs(base) {
  if (!safePath(base)) return [];
  const files = [];
  const splitGroups = new Map();

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (safePath(full)) await walk(full);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.gguf')) continue;
      if (entry.name.startsWith('._')) continue;

      let size = 0;
      try {
        const stat = await fsp.stat(full);
        size = stat.size;
      } catch {
        /* skip */
      }

      let rel = entry.name;
      try {
        rel = path.relative(base, full).split(path.sep).join('/');
      } catch {
        /* keep basename */
      }

      const splitMatch = entry.name.match(/^(.+)-(\d+)-of-(\d+)\.gguf$/i);
      if (splitMatch) {
        const [, prefix, partS, totalS] = splitMatch;
        const key = `${dir}\0${prefix}\0${totalS}`;
        let g = splitGroups.get(key);
        if (!g) {
          g = {
            name: entry.name,
            rel_path: rel,
            size_bytes: 0,
            role: ggufRole(entry.name),
            quant: ggufQuant(entry.name),
            parts: Number(totalS),
            split: true,
          };
          splitGroups.set(key, g);
        }
        g.size_bytes += size;
        if (Number(partS) === 1) {
          g.name = entry.name;
          g.rel_path = rel;
          g.role = ggufRole(entry.name);
          g.quant = ggufQuant(entry.name);
        }
        continue;
      }

      files.push({
        name: entry.name,
        rel_path: rel,
        size_bytes: size,
        role: ggufRole(entry.name),
        quant: ggufQuant(entry.name),
      });
    }
  }

  try {
    const stat = await fsp.stat(base);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  await walk(base);
  files.push(...splitGroups.values());
  files.sort((a, b) => {
    const ar = a.role !== 'model' ? 1 : 0;
    const br = b.role !== 'model' ? 1 : 0;
    if (ar !== br) return ar - br;
    return (a.rel_path || '').localeCompare(b.rel_path || '');
  });
  return files;
}

/**
 * Scan HuggingFace hub cache directory.
 * @param {string} cache
 * @param {Set<string>} seen
 * @returns {Promise<CachedModelRow[]>}
 */
async function scanHfCache(cache, seen) {
  const out = [];
  let entries;
  try {
    entries = await fsp.readdir(cache, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('models--')) continue;
    const repoId = entry.name.replace(/^models--/, '').replace(/--/g, '/');
    if (seen.has(repoId)) continue;
    seen.add(repoId);

    const blobs = path.join(cache, entry.name, 'blobs');
    const snap = path.join(cache, entry.name, 'snapshots');
    let sizeBytes = 0;
    let nbFiles = 0;
    let hasIncomplete = false;

    async function tallyDir(dir) {
      let items;
      try {
        items = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        if (!item.isFile()) continue;
        nbFiles += 1;
        if (item.name.endsWith('.incomplete')) hasIncomplete = true;
        try {
          const stat = await fsp.stat(path.join(dir, item.name));
          sizeBytes += stat.size;
        } catch {
          /* skip */
        }
      }
    }

    await tallyDir(blobs);
    if (sizeBytes === 0) {
      let snapDirs;
      try {
        snapDirs = await fsp.readdir(snap, { withFileTypes: true });
      } catch {
        snapDirs = [];
      }
      for (const sd of snapDirs) {
        if (!sd.isDirectory()) continue;
        await tallyDir(path.join(snap, sd.name));
      }
    }

    let isDiffusion = false;
    /** @type {CachedGgufFile[]} */
    const ggufFiles = [];
    let snapDirs;
    try {
      snapDirs = await fsp.readdir(snap, { withFileTypes: true });
    } catch {
      snapDirs = [];
    }
    for (const sd of snapDirs) {
      if (!sd.isDirectory()) continue;
      const sf = path.join(snap, sd.name);
      try {
        await fsp.access(path.join(sf, 'model_index.json'));
        isDiffusion = true;
      } catch {
        /* not diffusion */
      }
      const found = await collectGgufs(sf);
      for (const f of found) {
        ggufFiles.push({ ...f, rel_path: `${sd.name}/${f.rel_path}` });
      }
    }

    out.push({
      repo_id: repoId,
      size_bytes: sizeBytes,
      nb_files: nbFiles,
      has_incomplete: hasIncomplete,
      path: cache,
      is_diffusion: isDiffusion,
      is_gguf: ggufFiles.length > 0,
      gguf_files: ggufFiles,
      status: hasIncomplete ? 'incomplete' : 'cached',
    });
  }

  return out;
}

/**
 * Scan a plain directory for model folders (custom model dirs).
 * @param {string} dirPath
 * @param {Set<string>} seen
 */
async function scanCustomDir(dirPath, seen) {
  const out = [];
  const expanded = dirPath.startsWith('~')
    ? path.join(os.homedir(), dirPath.slice(1))
    : path.resolve(dirPath);
  if (!safePath(expanded)) return out;

  let entries;
  try {
    entries = await fsp.readdir(expanded, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('models--')) {
      continue;
    }
    const fp = path.join(expanded, entry.name);
    if (seen.has(entry.name)) continue;

    const ggufFiles = await collectGgufs(fp);
    let isModel = ggufFiles.length > 0;
    if (!isModel) {
      isModel = await dirLooksLikeModel(fp);
    }
    if (!isModel) continue;

    seen.add(entry.name);
    let sizeBytes = 0;
    let nbFiles = 0;
    await walkCount(fp, (sz) => {
      nbFiles += 1;
      sizeBytes += sz;
    });

    let isDiffusion = false;
    try {
      await fsp.access(path.join(fp, 'model_index.json'));
      isDiffusion = true;
    } catch {
      /* not diffusion */
    }

    out.push({
      repo_id: entry.name,
      size_bytes: sizeBytes,
      nb_files: nbFiles,
      has_incomplete: false,
      path: expanded,
      is_local_dir: true,
      is_diffusion: isDiffusion,
      is_gguf: ggufFiles.length > 0,
      gguf_files: ggufFiles,
      status: 'local',
    });
  }

  return out;
}

/**
 * @param {string} dir
 */
async function dirLooksLikeModel(dir) {
  async function walk(d) {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (
          lower.endsWith('.gguf') ||
          entry.name === 'config.json' ||
          lower.endsWith('.safetensors') ||
          lower.endsWith('.bin')
        ) {
          return true;
        }
      } else if (entry.isDirectory() && safePath(full)) {
        if (await walk(full)) return true;
      }
    }
    return false;
  }
  return walk(dir);
}

/**
 * @param {string} dir
 * @param {(size: number) => void} onFile
 */
async function walkCount(dir, onFile) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (safePath(full)) await walkCount(full, onFile);
      continue;
    }
    try {
      const stat = await fsp.stat(full);
      onFile(stat.size);
    } catch {
      /* skip */
    }
  }
}

/**
 * Scan Minnow download artifacts as cached rows.
 * @param {Set<string>} seen
 */
async function scanMinnowArtifacts(seen) {
  const artifacts = await scanInstalledArtifacts();
  /** @type {Map<string, CachedModelRow>} */
  const byRepo = new Map();

  for (const art of artifacts) {
    if (seen.has(art.repoId)) continue;
    let row = byRepo.get(art.repoId);
    if (!row) {
      row = {
        repo_id: art.repoId,
        size_bytes: 0,
        nb_files: 0,
        has_incomplete: false,
        path: path.dirname(art.path),
        is_gguf: true,
        gguf_files: [],
        status: 'downloaded',
      };
      byRepo.set(art.repoId, row);
      seen.add(art.repoId);
    }
    row.size_bytes += art.sizeBytes;
    row.nb_files += 1;
    row.gguf_files.push({
      name: art.filename,
      rel_path: art.filename,
      size_bytes: art.sizeBytes,
      role: ggufRole(art.filename),
      quant: ggufQuant(art.filename),
    });
  }

  return [...byRepo.values()];
}

/**
 * Query Ollama tags API for installed models.
 * @param {Set<string>} seen
 */
async function scanOllamaApi(seen) {
  const out = [];
  const urls = [
    'http://127.0.0.1:11434/api/tags',
    'http://localhost:11434/api/tags',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_500) });
      if (!res.ok) continue;
      const data = await res.json();
      const models = Array.isArray(data?.models) ? data.models : [];
      for (const item of models) {
        const name = item?.name || item?.model;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({
          repo_id: name,
          size_bytes: Number(item?.size ?? item?.size_bytes ?? 0),
          nb_files: 1,
          has_incomplete: false,
          path: 'ollama',
          backend: 'ollama',
          is_ollama: true,
          status: 'ollama',
        });
      }
      if (out.length) return out;
    } catch {
      /* try next url */
    }
  }

  return out;
}

/**
 * Full cached model scan (local machine).
 * @returns {Promise<{ models: CachedModelRow[] }>}
 */
export async function listCachedModels() {
  const seen = new Set();
  const models = [];

  for (const cache of hfCachePaths()) {
    models.push(...(await scanHfCache(cache, seen)));
  }

  models.push(...(await scanMinnowArtifacts(seen)));

  const config = await getModelsConfig();
  const dirs = Array.isArray(config.modelDirs)
    ? config.modelDirs.filter((d) => typeof d === 'string' && d.trim())
    : [];
  for (const dir of dirs) {
    models.push(...(await scanCustomDir(dir.trim(), seen)));
  }

  models.sort((a, b) => a.repo_id.localeCompare(b.repo_id));
  return { models };
}
