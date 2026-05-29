/**
 * Post-sync Minnow patches for vendored Impeccable reference/ and SKILL.upstream.md.
 * Idempotent: safe to run after every impeccable:sync.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Replace upstream template tokens with Minnow slash-command prefix. */
function substituteCommandPrefix(content) {
  return content.replaceAll('{{command_prefix}}', '/');
}

/** craft.md Step 1 — agents must not call run_impeccable for shape. */
const CRAFT_STEP1_OLD =
  'Run {{command_prefix}}impeccable shape, passing along whatever feature description the user provided. Shape is **required** for craft; it is what produces a confirmed direction.';

const CRAFT_STEP1_NEW =
  'Follow the **Shape workflow** section below (`## Prerequisite workflow: shape`). Run that discovery interview in chat using the user\'s feature description. Do not call `run_impeccable` or `npx impeccable shape`. Shape is **required** for craft; it is what produces a confirmed direction.';

/**
 * @param {string} targetDir Absolute path to src/skills/impeccable (or override)
 */
export function applyMinnowImpeccablePatches(targetDir) {
  const referenceDir = path.join(targetDir, 'reference');
  if (fs.existsSync(referenceDir)) {
    for (const name of fs.readdirSync(referenceDir)) {
      if (!name.endsWith('.md')) continue;
      const filePath = path.join(referenceDir, name);
      let text = fs.readFileSync(filePath, 'utf8');
      text = substituteCommandPrefix(text);
      if (name === 'craft.md') {
        text = text.replace(CRAFT_STEP1_OLD, CRAFT_STEP1_NEW);
        text = text.replace(
          'Run /impeccable shape, passing along whatever feature description the user provided. Shape is **required** for craft; it is what produces a confirmed direction.',
          CRAFT_STEP1_NEW,
        );
      }
      fs.writeFileSync(filePath, text, 'utf8');
    }
  }

  const upstreamSkill = path.join(targetDir, 'SKILL.upstream.md');
  if (fs.existsSync(upstreamSkill)) {
    const patched = substituteCommandPrefix(fs.readFileSync(upstreamSkill, 'utf8'));
    fs.writeFileSync(upstreamSkill, patched, 'utf8');
  }
}
