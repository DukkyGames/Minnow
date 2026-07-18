/**
 * LSP completion ranking — stable sort and composite deduplication (manager).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { invalidateLspConfigCache } from '../../server/lsp/config-loader.js';
import {
  getLspCompletions,
  notifyLspDocument,
  shutdownAllLsp,
} from '../../server/lsp/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = 'test/fixtures/sample.fake';
const SAMPLE_TEXT = 'let x = 1\n';

async function seedFakeLspHome(homeDir) {
  process.env.MINNOW_HOME = homeDir;
  resetMinnowHomeCache();
  invalidateLspConfigCache();
  shutdownAllLsp();
  await fs.rm(homeDir, { recursive: true, force: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.writeFile(
    path.join(homeDir, 'lsp.json'),
    `${JSON.stringify(
      {
        enabled: true,
        lsp: {
          fake: {
            disabled: false,
            command: ['node', 'test/fixtures/fake-lsp.mjs'],
            extensions: ['.fake'],
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

describe('LSP completion ranking', () => {
  let homeDir;

  before(async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;
    homeDir = path.join(__dirname, '../fixtures/lsp-completion-ranking-home');
    await seedFakeLspHome(homeDir);
  });

  after(() => {
    shutdownAllLsp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    invalidateLspConfigCache();
  });

  test('preserves sortText, filterText, preselect, commitCharacters and stable-sorts', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    await notifyLspDocument(SAMPLE_PATH, 'open', SAMPLE_TEXT);
    const { items, triggerCharacters } = await getLspCompletions(SAMPLE_PATH, 0, 4, {
      text: SAMPLE_TEXT,
    });

    assert.ok(triggerCharacters.includes('.'));
    assert.equal(items[0]?.label, 'rankedFirst');
    assert.equal(items[0]?.sortText, '0000');
    assert.equal(items[0]?.preselect, true);
    assert.deepEqual(items[0]?.commitCharacters, [';', '.']);

    const second = items.find((i) => i.label === 'rankedSecond');
    assert.equal(second?.filterText, 'rankedSecondFilter');
  });

  test('forwards LSP CompletionContext triggerCharacter', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const { items } = await getLspCompletions(SAMPLE_PATH, 0, 8, {
      text: 'console.',
      context: { triggerKind: 2, triggerCharacter: '.' },
    });
    assert.ok(items.some((i) => i.label === 'triggerDot'));
  });

  test('returns isIncomplete for TriggerForIncompleteCompletions', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const { items, isIncomplete } = await getLspCompletions(SAMPLE_PATH, 0, 4, {
      text: SAMPLE_TEXT,
      context: { triggerKind: 3 },
    });
    assert.equal(isIncomplete, true);
    assert.ok(items.some((i) => i.label === 'incompleteRefetch'));
  });

  test('syncs live editor text before completion request', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const liveText = 'console.\n';
    const { items } = await getLspCompletions(SAMPLE_PATH, 0, 8, {
      text: liveText,
      context: { triggerKind: 2, triggerCharacter: '.' },
    });
    assert.ok(items.length > 0);
    assert.ok(items.some((i) => i.label === 'triggerDot'));
  });

  test('keeps distinct overloads that share the same label', async () => {
    if (process.env.MINNOW_LSP_ENABLED === 'false') return;

    const { items } = await getLspCompletions(SAMPLE_PATH, 0, 4, {
      text: SAMPLE_TEXT,
    });
    const overloads = items.filter((i) => i.label === 'overload');
    assert.equal(overloads.length, 2);
    assert.ok(overloads.some((i) => i.insertText === 'overload()'));
    assert.ok(overloads.some((i) => i.insertText === 'overload(x)'));
  });
});
