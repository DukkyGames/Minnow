/**
 * Skill synthesis parser and SKILL.md draft validation tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildSkillMdDraft,
  parseSkillExtractionJson,
  slugifySkillId,
  validateSkillMdDraft,
} from '../../server/memory/skill-synthesis.js';

describe('skill synthesis', () => {
  test('parses JSON object from clean response', () => {
    const raw = `{"title":"Run tests","problem":"Need CI","solution":"Use npm test","steps":["npm test"],"tags":["testing"],"confidence":0.8}`;
    const obj = parseSkillExtractionJson(raw);
    assert.ok(obj);
    assert.equal(obj.title, 'Run tests');
  });

  test('parses JSON after stray brace prose (Odysseus stray brace case)', () => {
    const raw =
      'The session uses {placeholder} formatting. {"title":"Deploy app","problem":"Ship build","solution":"Use npm run build","steps":["npm run build","open dist"],"tags":["deploy"],"confidence":0.75}';
    const obj = parseSkillExtractionJson(raw);
    assert.ok(obj);
    assert.equal(obj.title, 'Deploy app');
  });

  test('returns null for bare null response', () => {
    const obj = parseSkillExtractionJson('null');
    assert.equal(obj, null);
  });

  test('builds valid SKILL.md draft', () => {
    const draft = buildSkillMdDraft({
      title: 'Lint before commit',
      problem: 'Style drift',
      solution: 'Run eslint',
      steps: ['npm run lint', 'fix issues'],
      tags: ['lint', 'quality'],
      confidence: 0.8,
    });
    assert.equal(validateSkillMdDraft(draft), true);
    assert.match(draft, /^---\nname: lint-before-commit/);
    assert.match(draft, /description:/);
  });

  test('slugify produces stable skill ids', () => {
    assert.equal(slugifySkillId('Hello World!'), 'hello-world');
    assert.equal(slugifySkillId(''), 'learned-skill');
  });
});
