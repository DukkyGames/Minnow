/**
 * mergeConfigMeta server.networkAccess validation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfigMeta } from '../../server/config/validators.js';

test('mergeConfigMeta defaults server.networkAccess to local', () => {
  const merged = mergeConfigMeta({}, { server: {} });
  const server = /** @type {{ networkAccess: string }} */ (merged.server);
  assert.equal(server.networkAccess, 'local');
});

test('mergeConfigMeta accepts lan and local', () => {
  const lan = mergeConfigMeta({}, { server: { networkAccess: 'lan' } });
  assert.equal(
    /** @type {{ networkAccess: string }} */ (lan.server).networkAccess,
    'lan',
  );

  const local = mergeConfigMeta({ server: { networkAccess: 'lan' } }, {
    server: { networkAccess: 'local' },
  });
  assert.equal(
    /** @type {{ networkAccess: string }} */ (local.server).networkAccess,
    'local',
  );
});

test('mergeConfigMeta rejects invalid networkAccess values', () => {
  const merged = mergeConfigMeta(
    { server: { networkAccess: 'local' } },
    { server: { networkAccess: 'internet' } },
  );
  assert.equal(
    /** @type {{ networkAccess: string }} */ (merged.server).networkAccess,
    'local',
  );
});
