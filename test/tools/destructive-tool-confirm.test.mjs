import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyDestructiveConfirmationAfterUserApproval } from '../../src/tools/destructive-tool-confirm.ts';

describe('destructive-tool-confirm', () => {
  it('sets confirmed on manage_brain delete_page after Ask approval', () => {
    const args = { action: 'delete_page', path: 'facts/test.md' };
    applyDestructiveConfirmationAfterUserApproval('manage_brain', args);
    assert.equal(args.confirmed, true);
  });

  it('does not override when confirmed is already true', () => {
    const args = { action: 'delete_page', path: 'facts/test.md', confirmed: true };
    applyDestructiveConfirmationAfterUserApproval('manage_brain', args);
    assert.equal(args.confirmed, true);
  });

  it('ignores non-destructive manage_brain actions', () => {
    const args = { action: 'list_pages' };
    applyDestructiveConfirmationAfterUserApproval('manage_brain', args);
    assert.equal(args.confirmed, undefined);
  });
});
