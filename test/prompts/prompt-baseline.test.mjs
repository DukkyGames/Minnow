import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('prompt-baseline', () => {
  test('isPromptPartDiffSupported excludes memory and skill', async () => {
    const { isPromptPartDiffSupported } = await import(
      '../../src/chat/prompts/prompt-baseline.ts'
    );
    assert.equal(isPromptPartDiffSupported('base'), true);
    assert.equal(isPromptPartDiffSupported('memory'), false);
    assert.equal(isPromptPartDiffSupported('skill'), false);
  });

  test('loadBuiltinPromptById returns builtin-only body', async () => {
    const { registerPromptFilesFromRaw, resetPromptRegistry, loadBuiltinPromptById } =
      await import('../../src/chat/prompts/prompt-loader.ts');
    resetPromptRegistry();
    registerPromptFilesFromRaw(
      {
        'base/default.full.md': `---
id: default
kind: base
label: Base
version: 1
---
Shipped base body`,
      },
      'builtin',
    );
    const loaded = loadBuiltinPromptById('base', 'default', 'full');
    assert.match(loaded?.body ?? '', /Shipped base body/);
    resetPromptRegistry();
  });
});
