/**
 * Skill synthesis parser and SKILL.md draft validation tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SKILL_GENERALIZE_PROMPT,
  SKILL_OBSERVE_PROMPT,
  buildSkillMdDraft,
  isDuplicateSkillCandidate,
  parseSkillExtractionJson,
  slugifySkillId,
  validateSkillMdDraft,
} from '../../server/memory/skill-synthesis.js';
import { DEFAULT_SYNTHESIS_CONFIG } from '../../server/brain/synthesis-config.js';

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

describe('skill recurrence gate config', () => {
  test('defaults require a second session before proposing', () => {
    assert.equal(DEFAULT_SYNTHESIS_CONFIG.skillMinOccurrences, 2);
  });

  test('observations are retained long enough to span sessions', () => {
    assert.equal(DEFAULT_SYNTHESIS_CONFIG.skillObservationRetentionDays, 45);
  });

  test('round and tool-call bars are both present', () => {
    assert.equal(DEFAULT_SYNTHESIS_CONFIG.skillMinRounds, 2);
    assert.equal(DEFAULT_SYNTHESIS_CONFIG.skillMinToolCalls, 2);
  });
});

describe('isDuplicateSkillCandidate', () => {
  test('exact title match (case-insensitive) is a duplicate', () => {
    assert.equal(
      isDuplicateSkillCandidate('Pin Dev Server Port', ['pin dev server port']),
      true,
    );
  });

  test('near-identical phrasing is a duplicate', () => {
    assert.equal(
      isDuplicateSkillCandidate('Pin the dev server port', ['Pin dev server port']),
      true,
    );
  });

  test('a rejected proposal title still blocks re-proposal (regression)', () => {
    // The old check only looked at merged skills, so rejecting a proposal never
    // stopped the same skill being proposed again on the next session.
    const rejectedTitles = ['Pin dev server port'];
    assert.equal(isDuplicateSkillCandidate('Pin dev server port', rejectedTitles), true);
  });

  test('unrelated title is not a duplicate', () => {
    assert.equal(
      isDuplicateSkillCandidate('Rotate database credentials', ['Pin dev server port']),
      false,
    );
  });

  test('empty title or empty catalog is never a duplicate', () => {
    assert.equal(isDuplicateSkillCandidate('', ['Anything']), false);
    assert.equal(isDuplicateSkillCandidate('Anything', []), false);
    assert.equal(isDuplicateSkillCandidate('Anything', undefined), false);
  });
});

describe('skill prompts', () => {
  test('observe prompt asks the model to judge recurrence', () => {
    assert.match(SKILL_OBSERVE_PROMPT, /same kind of problem again/i);
  });

  test('generalize prompt demands parameterization and problem-class titles', () => {
    assert.match(SKILL_GENERALIZE_PROMPT, /PARAMETERIZE/);
    assert.match(SKILL_GENERALIZE_PROMPT, /PROBLEM CLASS/);
    assert.match(SKILL_GENERALIZE_PROMPT, /existingSkills/);
  });
});
