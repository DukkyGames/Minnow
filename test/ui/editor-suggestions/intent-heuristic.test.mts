import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyIntentLine,
  intentInstructionFromLine,
  isIntentEligibleLanguage,
  leadingWhitespace,
  lineCommentForLanguage,
  looksLikeIntentProse,
} from '../../../src/ui/editor-suggestions/intent-heuristic.ts';

describe('classifyIntentLine — prose', () => {
  test('bare English reads as intent', () => {
    assert.equal(classifyIntentLine('fetch users and sort by name'), 'intent');
    assert.equal(classifyIntentLine('  open the config file and read it'), 'intent');
  });

  test('blank and whitespace-only lines are skipped', () => {
    assert.equal(classifyIntentLine(''), 'skip');
    assert.equal(classifyIntentLine('    '), 'skip');
  });

  test('fewer than three tokens is not enough signal', () => {
    assert.equal(classifyIntentLine('sort users'), 'code');
    assert.equal(classifyIntentLine('hello'), 'code');
  });
});

describe('classifyIntentLine — code false positives', () => {
  const codeLines = [
    'return users.sort((a,b) => a.name)',
    'const total = a + b;',
    'if user is not logged in',
    'for each user in the list',
    'import the users module',
    'doSomething(with, these, args)',
    'user.name = "value"',
    'std::vector<int> values',
    'let me count the cats',
    'obj->field->other',
    'items.map(x => x.id),',
    'function handleClick() {',
  ];

  for (const line of codeLines) {
    test(`code: ${line}`, () => {
      assert.equal(classifyIntentLine(line), 'code');
    });
  }

  test('camelCase and dotted identifiers drag the prose ratio down', () => {
    assert.equal(classifyIntentLine('userService fetchAll thenSort'), 'code');
    assert.equal(classifyIntentLine('foo.bar baz.qux quux.corge'), 'code');
  });

  test('a long string literal line is not intent', () => {
    assert.equal(
      classifyIntentLine('"the quick brown fox jumps over the lazy dog";'),
      'code',
    );
  });
});

describe('classifyIntentLine — comment-led', () => {
  test('a comment holding prose is intent', () => {
    assert.equal(
      classifyIntentLine('// fetch users and sort by name', { lineComment: '//' }),
      'intent',
    );
    assert.equal(
      classifyIntentLine('# read the config and merge it', { lineComment: '#' }),
      'intent',
    );
  });

  test('a comment holding code is not intent', () => {
    assert.equal(
      classifyIntentLine('// const x = compute(a, b);', { lineComment: '//' }),
      'code',
    );
  });

  test('an empty comment is skipped', () => {
    assert.equal(classifyIntentLine('//', { lineComment: '//' }), 'skip');
    assert.equal(classifyIntentLine('//   ', { lineComment: '//' }), 'skip');
  });

  test('comment-led prose is still intent when no comment token is configured', () => {
    // The marker counts as one non-word token; the prose ratio still clears 60%.
    assert.equal(classifyIntentLine('// fetch users and sort by name'), 'intent');
  });
});

describe('classifyIntentLine — sigil', () => {
  test('a sigil line is always intent', () => {
    assert.equal(classifyIntentLine('?? const x = compute(a, b);', { sigil: '??' }), 'intent');
  });

  test('a configured sigil turns off the prose heuristic entirely', () => {
    assert.equal(classifyIntentLine('fetch users and sort by name', { sigil: '??' }), 'code');
  });

  test('a sigil with no body is skipped', () => {
    assert.equal(classifyIntentLine('??', { sigil: '??' }), 'skip');
  });

  test('an empty sigil setting falls back to the heuristic', () => {
    assert.equal(classifyIntentLine('fetch users and sort by name', { sigil: '  ' }), 'intent');
  });
});

describe('intentInstructionFromLine', () => {
  test('strips a sigil', () => {
    assert.equal(intentInstructionFromLine('?? make it fast', { sigil: '??' }), 'make it fast');
  });

  test('strips a comment token', () => {
    assert.equal(
      intentInstructionFromLine('  // make it fast', { lineComment: '//' }),
      'make it fast',
    );
  });

  test('returns the trimmed line when there is no marker', () => {
    assert.equal(intentInstructionFromLine('  make it fast  '), 'make it fast');
  });
});

describe('language gating', () => {
  test('programming languages are eligible', () => {
    assert.equal(isIntentEligibleLanguage('TypeScript'), true);
    assert.equal(isIntentEligibleLanguage('Python'), true);
  });

  test('prose formats are not eligible', () => {
    assert.equal(isIntentEligibleLanguage('Markdown'), false);
    assert.equal(isIntentEligibleLanguage('Plain Text'), false);
  });

  test('an unresolved language is not eligible', () => {
    assert.equal(isIntentEligibleLanguage(null), false);
    assert.equal(isIntentEligibleLanguage(''), false);
  });

  test('line comment tokens resolve case-insensitively', () => {
    assert.equal(lineCommentForLanguage('TypeScript'), '//');
    assert.equal(lineCommentForLanguage('python'), '#');
    assert.equal(lineCommentForLanguage('SQL'), '--');
    assert.equal(lineCommentForLanguage('Brainfuck'), null);
    assert.equal(lineCommentForLanguage(null), null);
  });
});

describe('helpers', () => {
  test('looksLikeIntentProse is the prose half of the classifier', () => {
    assert.equal(looksLikeIntentProse('fetch users and sort'), true);
    assert.equal(looksLikeIntentProse('a = 1'), false);
  });

  test('leadingWhitespace captures tabs and spaces only', () => {
    assert.equal(leadingWhitespace('\t  code'), '\t  ');
    assert.equal(leadingWhitespace('code'), '');
  });
});
