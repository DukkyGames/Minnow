import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateToolRequiredArgs } from '../../src/tools/validate-tool-required-args.ts';

describe('validateToolRequiredArgs', () => {
  it('returns null when required fields are present', () => {
    assert.equal(validateToolRequiredArgs('read_file', { path: 'src/foo.ts' }), null);
  });

  it('errors when path is missing for read_file', () => {
    const err = validateToolRequiredArgs('read_file', {});
    assert.ok(err);
    assert.match(err!, /requires argument.*"path"/);
  });

  it('errors when path is whitespace only', () => {
    const err = validateToolRequiredArgs('read_file', { path: '   ' });
    assert.ok(err);
    assert.match(err!, /"path"/);
  });

  it('ignores unknown tools', () => {
    assert.equal(validateToolRequiredArgs('not_a_real_tool', {}), null);
  });
});
