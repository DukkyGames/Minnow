/**
 * Brain wiki tool ids back-fill into legacy tools.json on normalize.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeToolConfig } from '../../server/config/validators.js';
import { BRAIN_DESTRUCTIVE_TOOL_IDS, BRAIN_FULL_PERMISSION_TOOL_IDS } from '../../server/config/tool-ids.js';

describe('brain tool config back-fill', () => {
  it('inserts missing brain wiki tool ids at full permission', () => {
    const legacy = {
      enabled: {
        get_datetime: true,
        save_memory: true,
      },
      permissions: {
        default: {
          get_datetime: 'ask',
          save_memory: 'ask',
        },
      },
    };

    const config = normalizeToolConfig(legacy);

    assert.equal(config.permissions.default.save_memory, 'ask');

    for (const id of BRAIN_FULL_PERMISSION_TOOL_IDS) {
      if (id === 'save_memory') continue;
      assert.equal(
        config.permissions.default[id],
        'full',
        `${id} should be back-filled to full`,
      );
      assert.equal(config.enabled[id], true, `${id} should be enabled`);
    }
  });

  it('does not override explicitly stored brain tool permissions', () => {
    const stored = {
      enabled: {
        get_datetime: true,
        save_memory: true,
        brain_search: false,
      },
      permissions: {
        default: {
          get_datetime: 'ask',
          save_memory: 'ask',
          brain_search: 'off',
        },
      },
    };
    const config = normalizeToolConfig(stored);
    assert.equal(config.permissions.default.brain_search, 'off');
    assert.equal(config.enabled.brain_search, false);
  });

  it('inserts manage_brain at ask permission on back-fill', () => {
    const legacy = {
      enabled: { get_datetime: true },
      permissions: { default: { get_datetime: 'ask' } },
    };
    const config = normalizeToolConfig(legacy);
    for (const id of BRAIN_DESTRUCTIVE_TOOL_IDS) {
      assert.equal(config.permissions.default[id], 'ask', `${id} should back-fill to ask`);
      assert.equal(config.enabled[id], true, `${id} should be enabled`);
    }
    assert.ok(!BRAIN_FULL_PERMISSION_TOOL_IDS.includes('manage_brain'));
  });
});
