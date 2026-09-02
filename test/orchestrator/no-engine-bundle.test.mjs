/**
 * P4-E (MIN-717) — orphaned MIN-354 engine-bundle is gone.
 *
 * The packed copy under `server/session/` had zero callers after the v1 revert.
 * After this phase there is one engine: `server/orchestrator/`.
 *
 * Runs on the plain `node` runner with no loader flags.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('P4-E no engine-bundle (MIN-717)', () => {
  it('server/session/ is gone', () => {
    assert.equal(
      fs.existsSync(path.join(PROJECT_ROOT, 'server', 'session')),
      false,
      'server/session/ must not return — it was dead weight from the MIN-354 revert',
    );
  });
});
