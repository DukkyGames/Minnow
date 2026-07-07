import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  DEFAULT_DESIGN_INSTANCE_META,
  getDesignInstanceMetaCached,
  loadDesignInstanceMeta,
  loadDesignMeta,
  normalizeDesignMeta,
  resetDesignMetaCacheForTests,
  saveDesignInstanceMeta,
  saveDesignMeta,
} from '../../src/config/design-meta.ts';

describe('design-meta normalize', () => {
  test('normalizeDesignMeta returns empty instances for missing/invalid input', () => {
    assert.deepEqual(normalizeDesignMeta(null), { instances: {} });
    assert.deepEqual(normalizeDesignMeta(undefined), { instances: {} });
    assert.deepEqual(normalizeDesignMeta('nope'), { instances: {} });
  });

  test('normalizeDesignMeta fills defaults for a partial instance entry', () => {
    const meta = normalizeDesignMeta({ instances: { 'workspace-preview': { enabled: true } } });
    assert.deepEqual(meta.instances['workspace-preview'], {
      ...DEFAULT_DESIGN_INSTANCE_META,
      enabled: true,
    });
  });

  test('normalizeDesignMeta rejects unknown tool/viewport values', () => {
    const meta = normalizeDesignMeta({
      instances: {
        design: { tool: 'nonexistent', viewportPreset: 'wide-screen', darkModeEmulation: true },
      },
    });
    assert.equal(meta.instances.design!.tool, null);
    assert.equal(meta.instances.design!.viewportPreset, 'desktop');
    assert.equal(meta.instances.design!.darkModeEmulation, true);
  });

  test('normalizeDesignMeta accepts a valid tool/viewport combination', () => {
    const meta = normalizeDesignMeta({
      instances: { design: { enabled: true, tool: 'draw', viewportPreset: 'mobile' } },
    });
    assert.deepEqual(meta.instances.design, {
      enabled: true,
      tool: 'draw',
      viewportPreset: 'mobile',
      darkModeEmulation: false,
    });
  });

  test('normalizeDesignMeta drops entries keyed by blank ids', () => {
    const meta = normalizeDesignMeta({ instances: { '': { enabled: true }, '  ': { enabled: true } } });
    assert.deepEqual(meta.instances, {});
  });
});

describe('design-meta load/save round trip', () => {
  let store: Record<string, unknown> = {};

  beforeEach(() => {
    resetDesignMetaCacheForTests();
    store = {};
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        store = { ...store, ...body };
        return { ok: true, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => store } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    resetDesignMetaCacheForTests();
  });

  test('loadDesignMeta returns defaults when nothing persisted', async () => {
    const meta = await loadDesignMeta();
    assert.deepEqual(meta, { instances: {} });
  });

  test('saveDesignInstanceMeta persists a patch and loadDesignInstanceMeta reads it back', async () => {
    await saveDesignInstanceMeta('workspace-preview', { enabled: true, tool: 'select' });
    resetDesignMetaCacheForTests();

    const instance = await loadDesignInstanceMeta('workspace-preview');
    assert.deepEqual(instance, {
      enabled: true,
      tool: 'select',
      viewportPreset: 'desktop',
      darkModeEmulation: false,
    });
  });

  test('saveDesignInstanceMeta merges with existing instance state instead of clobbering it', async () => {
    await saveDesignInstanceMeta('design', { enabled: true, viewportPreset: 'tablet' });
    await saveDesignInstanceMeta('design', { darkModeEmulation: true });
    resetDesignMetaCacheForTests();

    const instance = await loadDesignInstanceMeta('design');
    assert.equal(instance.enabled, true);
    assert.equal(instance.viewportPreset, 'tablet');
    assert.equal(instance.darkModeEmulation, true);
  });

  test('saveDesignInstanceMeta keeps other instances untouched', async () => {
    await saveDesignInstanceMeta('workspace-preview', { enabled: true });
    await saveDesignInstanceMeta('design', { enabled: true, tool: 'comment' });
    resetDesignMetaCacheForTests();

    const meta = await loadDesignMeta();
    assert.equal(meta.instances['workspace-preview']!.enabled, true);
    assert.equal(meta.instances.design!.enabled, true);
    assert.equal(meta.instances.design!.tool, 'comment');
  });

  test('getDesignInstanceMetaCached falls back to defaults for an unknown instance before load', () => {
    assert.deepEqual(getDesignInstanceMetaCached('never-loaded'), DEFAULT_DESIGN_INSTANCE_META);
  });

  test('saveDesignMeta rejects fetch failures without throwing on the caller', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    resetDesignMetaCacheForTests();

    await assert.rejects(() => saveDesignMeta({ instances: {} }));
  });
});
