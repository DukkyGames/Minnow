/**
 * Skills loader, front matter parser, and slash command (Step 13).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseSkillFrontmatter,
  parseYamlFrontmatterBlock,
} from '../src/skills/parse-frontmatter.ts';
import { mergeSkillLists, resolveSkillDetail } from '../src/skills/loader.ts';
import {
  formatHistoryWithSkillTag,
  parseSlashCommand,
} from '../src/skills/parse-slash.ts';
import type { SkillDetail, SkillListItem } from '../src/skills/types.ts';

const FIXTURE_SKILL = `---
name: git-commit
description: Write conventional commit messages from staged diff context.
label: Git Commit
---

# Git commit helper

Use git_status and git_diff.
`;

const builtinGit: SkillListItem = {
  id: 'git-commit',
  label: 'Git Commit',
  description: 'Built-in',
  source: 'builtin',
};

const userGit: SkillListItem = {
  id: 'git-commit',
  label: 'Custom Git',
  description: 'User override',
  source: 'user',
};

const builtinOther: SkillListItem = {
  id: 'code-review',
  label: 'Code Review',
  description: 'Review',
  source: 'builtin',
};

describe('mergeSkillLists', () => {
  it('empty + empty returns []', () => {
    assert.deepEqual(mergeSkillLists([], []), []);
  });

  it('built-in only keeps source builtin', () => {
    const out = mergeSkillLists([builtinGit], []);
    assert.equal(out.length, 1);
    assert.equal(out[0].source, 'builtin');
  });

  it('user overrides same id', () => {
    const out = mergeSkillLists([builtinGit], [userGit]);
    assert.equal(out.length, 1);
    assert.equal(out[0].source, 'user');
    assert.equal(out[0].label, 'Custom Git');
  });

  it('union of different ids sorted by label', () => {
    const out = mergeSkillLists([builtinOther, builtinGit], []);
    assert.equal(out.length, 2);
    assert.equal(out[0].id, 'code-review');
    assert.equal(out[1].id, 'git-commit');
  });
});

describe('parseSkillFrontmatter', () => {
  it('splits valid front matter and body', () => {
    const { meta, body } = parseSkillFrontmatter(FIXTURE_SKILL);
    assert.equal(meta.name, 'git-commit');
    assert.equal(meta.description, 'Write conventional commit messages from staged diff context.');
    assert.equal(meta.label, 'Git Commit');
    assert.match(body, /git_status/);
  });

  it('throws when description missing', () => {
    const raw = `---
name: bad
---
body`;
    assert.throws(() => parseSkillFrontmatter(raw), /description/);
  });

  it('parses folded block scalar description (>-)', () => {
    const raw = `---
name: git-commit
description: >-
  Write conventional commit messages from staged diff context. Use when the user
  asks to commit or mentions git commit message.
---

# Body
`;
    const { meta } = parseSkillFrontmatter(raw);
    assert.match(meta.description, /conventional commit/);
    assert.match(meta.description, /git commit message/);
  });

  it('parseYamlFrontmatterBlock handles block scalars', () => {
    const meta = parseYamlFrontmatterBlock(
      'description: >-\n  Line one continues\n  on the next line.',
    );
    assert.match(meta.description, /Line one continues on the next line/);
  });
});

describe('parseSlashCommand', () => {
  it('parses /git-commit with trailing text', () => {
    const r = parseSlashCommand('/git-commit fix bug');
    assert.equal(r.skillId, 'git-commit');
    assert.equal(r.userText, 'fix bug');
  });

  it('returns null skill for plain text', () => {
    const r = parseSlashCommand('hello');
    assert.equal(r.skillId, null);
    assert.equal(r.userText, 'hello');
  });

  it('formatHistoryWithSkillTag adds footer', () => {
    const s = formatHistoryWithSkillTag('fix bug', 'git-commit');
    assert.match(s, /fix bug/);
    assert.match(s, /\[skill: git-commit\]/);
  });
});

describe('resolveSkillDetail', () => {
  it('prefers user detail', () => {
    const builtin: SkillDetail = { ...builtinGit, body: 'builtin body' };
    const user: SkillDetail = { ...userGit, body: 'USER_OVERRIDE_BODY' };
    const r = resolveSkillDetail('git-commit', [builtin], [user]);
    assert.equal(r?.body, 'USER_OVERRIDE_BODY');
  });
});
