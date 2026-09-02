
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const STRICT = process.env.CAVEMAN_SYNC_STRICT === '1';
const TARGET_DIR = path.resolve(
  PROJECT_ROOT,
  process.env.CAVEMAN_SKILL_TARGET || 'src/skills/caveman',
);
const UPSTREAM_URL =
  process.env.CAVEMAN_UPSTREAM_URL ||
  'https://raw.githubusercontent.com/JuliusBrussee/caveman/main/skills/caveman/SKILL.md';

const WRAPPER_COMMENT =
  '<!-- Upstream: https://github.com/JuliusBrussee/caveman @ skills/caveman/SKILL.md (MIT) -->';

/**
 * @param {string} message
 */
function warn(message) {
  console.warn(`[caveman:sync] ${message}`);
}

/**
 * @param {string} message
 */
function fail(message) {
  if (STRICT) {
    console.error(`[caveman:sync] ${message}`);
    process.exit(1);
  }
  warn(`${message} (non-strict; set CAVEMAN_SYNC_STRICT=1 to fail CI)`);
}

/**
 * @param {string} upstreamRaw
 * @returns {string}
 */
function buildVendoredSkill(upstreamRaw) {
  const trimmed = upstreamRaw.trim();
  const parts = trimmed.split(/^---\s*$/m);
  if (parts.length < 3) {
    return `${trimmed}\n\n${WRAPPER_COMMENT}\n`;
  }

  const frontmatter = parts[1].trim();
  let body = parts.slice(2).join('\n---\n').trim();
  if (!body.includes(WRAPPER_COMMENT)) {
    body = `${WRAPPER_COMMENT}\n\n${body}`;
  }

  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

async function main() {
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  let upstreamRaw;
  try {
    const res = await fetch(UPSTREAM_URL, { redirect: 'follow' });
    if (!res.ok) {
      fail(`Fetch failed (${res.status}): ${UPSTREAM_URL}`);
      return;
    }
    upstreamRaw = await res.text();
  } catch (err) {
    fail(`Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const upstreamCopy = path.join(TARGET_DIR, 'SKILL.upstream.md');
  const header =
    '<!-- AUTO-SYNCED from caveman upstream — do not edit; run npm run caveman:sync -->\n\n';
  fs.writeFileSync(upstreamCopy, header + upstreamRaw.trim() + '\n', 'utf8');

  const vendored = buildVendoredSkill(upstreamRaw);
  fs.writeFileSync(path.join(TARGET_DIR, 'SKILL.md'), vendored, 'utf8');

  console.log(
    `[caveman:sync] Synced SKILL.md → ${path.relative(PROJECT_ROOT, TARGET_DIR)}`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
