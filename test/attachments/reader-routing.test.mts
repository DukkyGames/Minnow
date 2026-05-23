/**
 * processFile routes office files through read_document (MIN-32).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processFile } from '../../src/attachments/reader.ts';

describe('processFile office routing', () => {
  it('routes xlsx through read_document instead of unsupported', async () => {
    const file = new File([new Uint8Array([0x50, 0x4b])], 'report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const att = await processFile(file);
    assert.equal(
      String(att.error ?? '').includes('Unsupported file type'),
      false,
      att.error ?? att.kind,
    );
  });

  it('still blocks oversize office files', async () => {
    const file = new File([new Uint8Array(11 * 1024 * 1024)], 'big.xlsx');
    const att = await processFile(file);
    assert.equal(att.kind, 'error');
    assert.match(att.error ?? '', /10MB limit/);
  });
});
