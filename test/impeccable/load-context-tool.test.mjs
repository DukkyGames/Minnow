/**
 * load_impeccable_context server tool resolves script from app root.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { toolLoadImpeccableContext } from '../../server/impeccable/load-impeccable-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('load_impeccable_context tool', () => {
  it('returns JSON with designJson for Minnow workspace', async () => {
    const { result } = await toolLoadImpeccableContext(PROJECT_ROOT, PROJECT_ROOT);
    assert.ok(!result.startsWith('Error:'), result.slice(0, 200));
    const payload = JSON.parse(result);
    assert.equal(payload.designJson.schemaVersion, 2);
    assert.equal(payload.hasProduct, true);
    assert.equal(payload.hasDesign, true);
  });
});
