import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('notification preview helpers', () => {
  test('formatToolFailurePreview summarizes multiple errors', async () => {
    const preview = await import('../../src/notifications/preview.ts');
    const text = preview.formatToolFailurePreview([
      { role: 'tool', content: 'Error: file not found', tool_call_id: '1' },
      { role: 'tool', content: 'Error: timeout', tool_call_id: '2' },
    ]);
    assert.equal(text, '2 tools failed');
  });

  test('truncatePreview strips markdown headings', async () => {
    const preview = await import('../../src/notifications/preview.ts');
    const text = preview.truncatePreview('## Hello **world**');
    assert.match(text, /Hello world/);
  });
});
