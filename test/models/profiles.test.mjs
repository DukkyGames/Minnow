/**
 * Serve profile preset tests — port of Odysseus test_serve_profiles shape.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeServeProfiles, profileToLlamaArgs } from '../../server/models/profiles.js';

describe('serve profiles', () => {
  const system = {
    gpuVramGb: 12,
    availableRamGb: 32,
    totalRamGb: 64,
  };

  const model = {
    name: 'demo/7b',
    parameters_raw: 7,
    quantization: 'Q4_K_M',
    is_moe: false,
  };

  test('returns quality, balanced, speed presets', () => {
    const profiles = computeServeProfiles(system, model);
    assert.equal(profiles.length, 3);
    assert.deepEqual(
      profiles.map((p) => p.key),
      ['quality', 'balanced', 'speed'],
    );
  });

  test('presets use 128k / 64k / 32k context windows', () => {
    const profiles = computeServeProfiles(system, model);
    const byKey = Object.fromEntries(profiles.map((p) => [p.key, p]));
    assert.equal(byKey.quality?.ctx, 131_072);
    assert.equal(byKey.balanced?.ctx, 65_536);
    assert.equal(byKey.speed?.ctx, 32_768);
  });

  test('balanced profile fits on 12 GB GPU budget', () => {
    const profiles = computeServeProfiles(system, model);
    const balanced = profiles.find((p) => p.key === 'balanced');
    assert.ok(balanced);
    assert.equal(balanced.fits, true);
    assert.equal(balanced.ctx, 65_536);
  });

  test('profileToLlamaArgs includes context and ngl', () => {
    const profiles = computeServeProfiles(system, model);
    const args = profileToLlamaArgs(profiles[1], '/tmp/model.gguf', 8085);
    assert.ok(args.includes('-m'));
    assert.ok(args.includes('/tmp/model.gguf'));
    assert.ok(args.includes('--port'));
    assert.ok(args.includes('8085'));
    assert.ok(args.includes('-c'));
    assert.ok(args.includes('-ngl'));
  });
});
