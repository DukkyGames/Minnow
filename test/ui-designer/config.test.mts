/**
 * UI Designer config resolution (Step 15) — static fixtures.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  normalizeUiDesignerConfig,
  resolveUiDesignerModel,
} from '../../src/agents/ui-designer/model-resolution.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../fixtures/ui-designer-config.json');

async function loadFixture() {
  return JSON.parse(await fs.readFile(FIXTURE, 'utf8')) as Record<
    string,
    {
      uiDesigner: Record<string, unknown>;
      chatProviderId: string;
      chatModelId: string;
    }
  >;
}

describe('resolveUiDesignerModel', () => {
  test('U1: full config returns configured provider + model', async () => {
    const fx = await loadFixture();
    const row = fx.dedicated;
    const out = resolveUiDesignerModel({
      uiDesigner: row.uiDesigner,
      chatProviderId: row.chatProviderId,
      chatModelId: row.chatModelId,
    });
    assert.ok(!('error' in out));
    assert.equal(out.providerId, 'lm-studio-local');
    assert.equal(out.modelId, 'vision-model-fixed-id');
  });

  test('U2: empty config + fallbackToChatModel uses chat model', async () => {
    const fx = await loadFixture();
    const row = fx.fallback;
    const out = resolveUiDesignerModel({
      uiDesigner: row.uiDesigner,
      chatProviderId: row.chatProviderId,
      chatModelId: row.chatModelId,
    });
    assert.ok(!('error' in out));
    assert.equal(out.providerId, 'lm-studio-local');
    assert.equal(out.modelId, 'local-chat-model');
  });

  test('U3: empty config + fallback false returns error', async () => {
    const fx = await loadFixture();
    const row = fx.noFallback;
    const out = resolveUiDesignerModel({
      uiDesigner: row.uiDesigner,
      chatProviderId: row.chatProviderId,
      chatModelId: row.chatModelId,
    });
    assert.ok('error' in out);
    assert.match(out.error, /Configure UI Designer model/);
  });

  test('normalizeUiDesignerConfig defaults fallbackToChatModel true', () => {
    const cfg = normalizeUiDesignerConfig({});
    assert.equal(cfg.fallbackToChatModel, true);
  });
});
