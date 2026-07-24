/**
 * Skill directory scanner — excludes infrastructure folders from skill discovery.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldExposeSkillDir } from '../server/skills/scan.js';

describe('shouldExposeSkillDir', () => {
  it('excludes underscore-prefixed template dirs', () => {
    assert.equal(shouldExposeSkillDir('_example'), false);
    assert.equal(shouldExposeSkillDir('_template'), false);
  });

  it('excludes skills library infrastructure folder', () => {
    assert.equal(shouldExposeSkillDir('library'), false);
  });

  it('includes normal built-in skill folders', () => {
    assert.equal(shouldExposeSkillDir('impeccable'), true);
    assert.equal(shouldExposeSkillDir('git-commit'), true);
  });
});
