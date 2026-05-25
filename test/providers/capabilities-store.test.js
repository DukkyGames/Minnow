/**
 * capabilities-store: atomic write, corrupt recovery, defaults.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTestHome, rmTestHome } from './test-helpers.js';
import {
  readCapabilities,
  writeCapabilities,
  mergeCapabilities,
} from '../../server/providers/capabilities-store.js';
import { ensureProviderRegistry, createProvider } from '../../server/providers/store.js';

let homeDir;

before(async () => {
  homeDir = setTestHome(process.env, 'minnow-cap-store');
  await ensureProviderRegistry();
  await createProvider({
    id: 'cap-test-provider',
    label: 'Cap Test',
    baseUrl: 'http://127.0.0.1:9',
    apiKind: 'openai-v1',
  });
});

after(async () => {
  await rmTestHome(homeDir);
});

describe('capabilities-store', () => {
  it('returns empty models when file missing', async () => {
    const data = await readCapabilities('cap-test-provider');
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.probedAt, '');
    assert.deepEqual(data.models, {});
  });

  it('round-trips write and read', async () => {
    const written = await writeCapabilities('cap-test-provider', {
      schemaVersion: 1,
      providerId: 'cap-test-provider',
      probedAt: '2026-05-22T12:00:00.000Z',
      apiKind: 'openai-v1',
      models: {
        'test/model': {
          vision: false,
          tools: true,
          streaming: true,
          grammar: null,
          reasoning: null,
          contextLength: 8192,
          loadState: 'loaded',
          sources: { tools: 'probe' },
          probeErrors: {},
        },
      },
    });
    assert.equal(written.models['test/model'].tools, true);
    const read = await readCapabilities('cap-test-provider');
    assert.equal(read.models['test/model'].contextLength, 8192);
  });

  it('recovers from corrupt JSON', async () => {
    const file = path.join(
      homeDir,
      'providers',
      'cap-test-provider',
      'capabilities.json',
    );
    await fs.writeFile(file, '{ not json', 'utf8');
    const data = await readCapabilities('cap-test-provider');
    assert.deepEqual(data.models, {});
  });

  it('merge patches per model id', async () => {
    const merged = await mergeCapabilities(
      'cap-test-provider',
      {
        'a/model': { tools: true, sources: { tools: 'probe' } },
      },
      { probedAt: '2026-05-23T00:00:00.000Z', apiKind: 'openai-v1' },
    );
    assert.equal(merged.models['a/model'].tools, true);
    assert.equal(merged.probedAt, '2026-05-23T00:00:00.000Z');
  });
});
