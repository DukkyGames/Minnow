/**
 * Full vs Lite composed length ratio (char proxy for tokens).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, test } from 'node:test';
import { composeSystemPrompt } from '../../src/chat/prompts/prompt-composer.ts';
import {
  registerPromptFilesFromRaw,
  resetPromptRegistry,
} from '../../src/chat/prompts/prompt-loader.ts';
import golden from './fixtures/compose-context.golden.json' with { type: 'json' };

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const PROMPTS_ROOT = path.join(REPO_ROOT, 'src', 'chat', 'prompts');

async function loadShippedPromptsRaw() {
  const out = {};
  async function walk(dir, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '_example') continue;
        await walk(full, rel);
      } else if (entry.name.endsWith('.md')) {
        out[`./${rel.replace(/\\/g, '/')}`] = await fs.readFile(full, 'utf8');
      }
    }
  }
  await walk(PROMPTS_ROOT);
  return out;
}

describe('prompt-composer profiles', () => {
  beforeEach(async () => {
    resetPromptRegistry();
    registerPromptFilesFromRaw(await loadShippedPromptsRaw());
  });

  test('lite length <= 40% of full for golden fixture context', () => {
    const full = composeSystemPrompt({
      ...golden,
      profile: 'full',
      enabledToolSummaries:
        'get_datetime: Returns current date and time.\ncalculate: Evaluates a safe math expression.\nweb_search: Search the web.\nwikipedia_search: Search Wikipedia.',
      enabledToolIds: ['get_datetime', 'calculate', 'web_search', 'wikipedia_search'],
    });
    const lite = composeSystemPrompt({
      ...golden,
      profile: 'lite',
      enabledToolSummaries: 'get_datetime, calculate, web_search, wikipedia_search',
      enabledToolIds: ['get_datetime', 'calculate', 'web_search', 'wikipedia_search'],
    });
    assert.ok(full.length > 0);
    assert.ok(lite.length > 0);
    // Character-length proxy for token ratio (see step-04 plan).
    assert.ok(
      lite.length <= full.length * 0.4,
      `lite ${lite.length} vs full ${full.length}`,
    );
  });
});
