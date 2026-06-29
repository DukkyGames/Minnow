/**
 * Post-sync Minnow patches for vendored Matt Pocock skills.
 * Idempotent: safe to run after every matt-pocock-skills:sync.
 * Does not modify SKILL.upstream.md snapshots.
 */

import fs from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mjs',
  '.js',
  '.ts',
  '.json',
  '.sh',
  '.txt',
  '.yaml',
  '.yml',
]);

const COMPACT_SECTION_NEW =
  '- **Context breaks in Minnow** — Minnow has no `/compact` command. At intentional phase breaks, start a **new chat** or use **`/handoff`** to preserve context in a markdown file and continue in a fresh session. `/handoff` forks to a new session; a new chat starts without verbatim history.';

/**
 * @param {string} content
 * @returns {string}
 */
export function applyMinnowTextPatches(content) {
  let text = content;

  text = text.replaceAll('setup-matt-pocock-skills', 'setup-minnow-skills');
  text = text.replaceAll('/setup-matt-pocock-skills', '/setup-minnow-skills');
  text = text.replaceAll('ask-matt', 'ask-minnow');
  text = text.replaceAll('/ask-matt', '/ask-minnow');

  text = text.replaceAll('# Ask Matt', '# Ask Minnow');
  text = text.replaceAll("# Setup Matt Pocock's Skills", '# Setup Minnow Skills');

  text = text.replaceAll('/review', '/code-review');

  if (text.includes('`/compact`')) {
    text = text.replace(
      /- \*\*`\/compact`\*\* \(built-in\)[^\n]*\n/,
      `${COMPACT_SECTION_NEW}\n`,
    );
  }

  return text;
}

/**
 * Add or refresh MIT upstream attribution after SKILL.md front matter.
 * @param {string} content
 * @param {string} upstreamRelPath e.g. skills/engineering/implement/SKILL.md
 */
function ensureSkillAttribution(content, upstreamRelPath) {
  const comment = `<!-- Upstream: https://github.com/mattpocock/skills @ ${upstreamRelPath} (MIT) -->`;
  if (content.includes(comment)) return content;

  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) {
    return `${content.trim()}\n\n${comment}\n`;
  }

  const head = match[0];
  let body = content.slice(head.length).trimStart();
  if (!body.startsWith(comment)) {
    body = `${comment}\n\n${body}`;
  }
  return `${head}${body}\n`;
}

/**
 * Patch ask-minnow front matter label when present or after name line.
 * @param {string} content
 */
function patchAskMinnowFrontmatter(content) {
  if (!content.includes('name: ask-minnow')) return content;

  if (/^label:\s*Ask Minnow\s*$/m.test(content)) return content;

  if (/^name:\s*ask-minnow\s*$/m.test(content)) {
    return content.replace(/^name:\s*ask-minnow\s*$/m, 'name: ask-minnow\nlabel: Ask Minnow');
  }

  return content;
}

/**
 * @param {string} filePath
 */
function isTextSkillFile(filePath) {
  if (path.basename(filePath) === 'SKILL.upstream.md') return false;
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return path.basename(filePath) === 'SKILL.md';
}

/**
 * @param {string} skillDir Absolute path to src/skills/<id>
 * @param {{ id: string, category: string, upstreamId: string }} entry
 */
export function applyMinnowPatchesToSkillDir(skillDir, entry) {
  const upstreamSkillPath = `skills/${entry.category}/${entry.upstreamId}/SKILL.md`;

  /** @param {string} dir */
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (!isTextSkillFile(filePath)) continue;

      let text = fs.readFileSync(filePath, 'utf8');
      text = applyMinnowTextPatches(text);

      if (path.basename(filePath) === 'SKILL.md') {
        text = ensureSkillAttribution(text, upstreamSkillPath);
        if (entry.id === 'ask-minnow') {
          text = patchAskMinnowFrontmatter(text);
        }
      }

      fs.writeFileSync(filePath, text, 'utf8');
    }
  }

  if (fs.existsSync(skillDir)) {
    walk(skillDir);
  }
}
