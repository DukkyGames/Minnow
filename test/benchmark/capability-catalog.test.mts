/**
 * Capability matrix catalog shape and metadata tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CAPABILITY_CATALOG, getCapabilityById } from '../../src/benchmark/capabilities/catalog.ts';
import {
  CAPABILITY_GROUP_COUNTS,
  CAPABILITY_GROUP_ORDER,
  countCapabilitiesInGroup,
} from '../../src/benchmark/capabilities/groups.ts';

describe('capability catalog', () => {
  test('has 59 capabilities in spreadsheet order', () => {
    assert.equal(CAPABILITY_CATALOG.length, 59);
    const ids = CAPABILITY_CATALOG.map((c) => c.id);
    assert.deepEqual(new Set(ids).size, ids.length);
  });

  test('per-group counts match the 13 bands', () => {
    for (const groupId of CAPABILITY_GROUP_ORDER) {
      assert.equal(
        countCapabilitiesInGroup(CAPABILITY_CATALOG, groupId),
        CAPABILITY_GROUP_COUNTS[groupId],
        groupId,
      );
    }
  });

  test('has 15 tier-1 capabilities', () => {
    assert.equal(CAPABILITY_CATALOG.filter((c) => c.tier === 1).length, 15);
  });

  test('auto capabilities have probe specs; manual have reasons', () => {
    const auto = CAPABILITY_CATALOG.filter((c) => c.scoreMode === 'auto');
    const manual = CAPABILITY_CATALOG.filter((c) => c.scoreMode === 'manual');
    assert.equal(auto.length, 55);
    assert.equal(manual.length, 4);
    for (const cap of auto) {
      assert.ok(cap.probe, `${cap.id}: missing probe`);
    }
    for (const cap of manual) {
      assert.ok(cap.manualReason?.trim(), `${cap.id}: missing manualReason`);
      assert.equal(cap.probe, undefined, `${cap.id}: manual must not have probe`);
    }
  });

  test('only retired rows and rows with no model-side signal stay manual', () => {
    const manualIds = CAPABILITY_CATALOG.filter((c) => c.scoreMode === 'manual').map((c) => c.id);
    assert.deepEqual(manualIds.sort(), [
      'features-compare',
      'features-mcp',
      'features-research',
      'features-voice',
    ]);
  });

  test('catalog prompts read as instructions, not generated fragments', () => {
    for (const cap of CAPABILITY_CATALOG) {
      assert.ok(cap.prompt.trim().length >= 12, `${cap.id}: prompt too short`);
      assert.ok(
        !/^(Exercise:|for a |a task|it )/i.test(cap.prompt),
        `${cap.id}: generated fragment "${cap.prompt}"`,
      );
      assert.ok(!/[([]$/.test(cap.prompt.trim()), `${cap.id}: truncated prompt`);
    }
  });

  test('stable ids resolve from catalog', () => {
    assert.ok(getCapabilityById('files-replace-text'));
    assert.ok(getCapabilityById('core-streaming'));
    assert.equal(getCapabilityById('not-a-cap'), undefined);
  });

  test('first and last entries match spreadsheet columns', () => {
    assert.equal(CAPABILITY_CATALOG[0].id, 'core-streaming');
    assert.equal(CAPABILITY_CATALOG[58].id, 'features-markdown');
  });
});
