/**
 * Static verification for BUG-008: modes suite positive probes vs tool policy and defaults.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { filterToolsByMode } from '../../src/chat/modes/tool-policy.ts';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import { defaultToolConfig } from '../../src/config/defaults.ts';
import { getToolPermissionForId } from '../../src/tools/config.ts';

/** Mirrors MODE_POSITIVE in src/benchmark/suites/modes.ts */
const MODE_POSITIVE: Record<string, string> = {
  general: 'read_file',
  build: 'list_directory',
  plan: 'read_file',
  research: 'web_search',
  orchestrate: 'list_directory',
  reef: 'get_datetime',
};

describe('modes suite probe prerequisites (BUG-008)', () => {
  test('expected tools are allowed by each mode tool policy', () => {
    for (const [mode, expected] of Object.entries(MODE_POSITIVE)) {
      const allowed = filterToolsByMode(BUILT_IN_TOOLS, mode as 'build').map(
        (t) => t.id,
      );
      assert.ok(
        allowed.includes(expected),
        `${mode} policy must allow ${expected}`,
      );
    }
  });

  test('default tool config disables most positive probe tools', () => {
    const cfg = defaultToolConfig();
    const disabledByDefault = [
      ...new Set(
        Object.values(MODE_POSITIVE).filter(
          (expected) => getToolPermissionForId(cfg, expected) === 'off',
        ),
      ),
    ].sort();
    assert.deepEqual(
      disabledByDefault,
      ['list_directory', 'read_file'],
      'fresh install cannot pass build/plan/orchestrate positive probes without enabling file tools',
    );
    assert.notEqual(getToolPermissionForId(cfg, 'web_search'), 'off');
    assert.notEqual(getToolPermissionForId(cfg, 'get_datetime'), 'off');
  });
});
