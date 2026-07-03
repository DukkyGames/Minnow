/**
 * Reef prompts must require ask_question before saving user modules.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODES_DIR = path.join(__dirname, '../../../src/chat/prompts/modes');

function readPrompt(name) {
  return fs.readFileSync(path.join(MODES_DIR, name), 'utf8');
}

describe('reef optional save prompt', () => {
  test('reef.full.md requires ask_question before module writes', () => {
    const content = readPrompt('reef.full.md');

    assert.ok(
      content.includes('@minnow/reef/modules'),
      'reef.full.md must document @minnow/reef/modules paths',
    );
    assert.match(
      content,
      /ask_question/i,
      'reef.full.md must reference ask_question for save confirmation',
    );
    assert.match(
      content,
      /Never.*(?:write_file|save_file)/i,
      'reef.full.md must forbid unconfirmed module writes',
    );
    assert.ok(
      content.includes('save_reef_module'),
      'reef.full.md must include save_reef_module question example',
    );
  });

  test('reef.lite.md mentions confirm-before-save for modules', () => {
    const content = readPrompt('reef.lite.md');
    assert.ok(content.includes('@minnow/reef/modules'));
    assert.match(content, /ask_question/i);
    assert.match(content, /write_file/i);
  });
});
