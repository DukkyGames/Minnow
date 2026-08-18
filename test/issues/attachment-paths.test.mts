/**
 * Attachment path safety.
 *
 * The filename on an attachment is the one input a client fully controls, and
 * it ends up in `path.resolve`. Every one of these cases is a traversal that
 * must resolve to a single segment under the attachments directory or throw.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  ISSUES_ATTACHMENTS_DIRNAME,
  issuesAttachmentPath,
  resolveIssueAttachmentPath,
  sanitizeAttachmentSegment,
} from '../../server/config/paths.js';
import { getMinnowHome } from '../../server/config/home.js';

function attachmentsRoot(): string {
  return path.resolve(path.resolve(getMinnowHome()), ISSUES_ATTACHMENTS_DIRNAME);
}

function assertUnderRoot(absolute: string): void {
  const root = attachmentsRoot();
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  assert.ok(
    absolute.startsWith(rootWithSep),
    `${absolute} escaped ${root}`,
  );
}

describe('sanitizeAttachmentSegment', () => {
  test('collapses separators and traversal into dashes', () => {
    assert.equal(sanitizeAttachmentSegment('../../etc/passwd'), 'etc-passwd');
    assert.equal(sanitizeAttachmentSegment('a\\b\\c.png'), 'a-b-c.png');
  });

  test('strips leading dots so nothing becomes a hidden file', () => {
    assert.equal(sanitizeAttachmentSegment('.env'), 'env');
    assert.equal(sanitizeAttachmentSegment('..'), 'file');
  });

  test('falls back when nothing usable survives', () => {
    assert.equal(sanitizeAttachmentSegment(''), 'file');
    assert.equal(sanitizeAttachmentSegment('////'), 'file');
    assert.equal(sanitizeAttachmentSegment(null), 'file');
    assert.equal(sanitizeAttachmentSegment('🐟'), 'file');
  });

  test('keeps ordinary names intact', () => {
    assert.equal(sanitizeAttachmentSegment('screenshot-2.png'), 'screenshot-2.png');
  });

  test('caps the length so a long name cannot exhaust the path limit', () => {
    assert.ok(sanitizeAttachmentSegment('x'.repeat(400)).length <= 96);
  });
});

describe('issuesAttachmentPath', () => {
  test('stays under the attachments directory for hostile names', () => {
    for (const name of [
      '../../../../etc/passwd',
      '..\\..\\windows\\system32\\config',
      '/absolute/path.png',
      'C:\\Windows\\evil.png',
      '....//....//x.png',
    ]) {
      assertUnderRoot(issuesAttachmentPath('MIN-1', name));
    }
  });

  test('stays under the attachments directory for a hostile issue id', () => {
    assertUnderRoot(issuesAttachmentPath('../../..', 'a.png'));
  });

  test('produces exactly two segments below the root', () => {
    const absolute = issuesAttachmentPath('MIN-12', 'shot.png');
    const relative = path.relative(attachmentsRoot(), absolute);
    assert.deepEqual(relative.split(path.sep), ['MIN-12', 'shot.png']);
  });
});

describe('resolveIssueAttachmentPath', () => {
  test('accepts a two-segment key', () => {
    const absolute = resolveIssueAttachmentPath('MIN-12/shot.png');
    assert.equal(absolute, issuesAttachmentPath('MIN-12', 'shot.png'));
  });

  test('rejects keys that are not exactly two segments', () => {
    assert.throws(() => resolveIssueAttachmentPath('shot.png'));
    assert.throws(() => resolveIssueAttachmentPath('a/b/c.png'));
    assert.throws(() => resolveIssueAttachmentPath(''));
    assert.throws(() => resolveIssueAttachmentPath('   '));
  });

  test('a traversal key still resolves inside the root', () => {
    // Two segments, so it is accepted — and both are sanitized, so it lands
    // in a literal `..`-free folder rather than above the root.
    assertUnderRoot(resolveIssueAttachmentPath('../secrets'));
  });
});
