/**
 * STT catalog helpers — CTranslate2 download repo mapping.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isSttCatalogModel,
  resolveSttDownloadRepoId,
} from '../../server/voice/stt-catalog.js';

describe('stt catalog', () => {
  test('resolveSttDownloadRepoId maps openai catalog ids to Systran CTranslate2 repos', () => {
    assert.equal(
      resolveSttDownloadRepoId('openai/whisper-small'),
      'Systran/faster-whisper-small',
    );
    assert.equal(
      resolveSttDownloadRepoId('openai/whisper-large-v3'),
      'Systran/faster-whisper-large-v3',
    );
    assert.equal(resolveSttDownloadRepoId('custom/whisper-model'), 'custom/whisper-model');
  });

  test('isSttCatalogModel recognizes bundled whisper ids', () => {
    assert.equal(isSttCatalogModel('openai/whisper-base'), true);
    assert.equal(isSttCatalogModel('Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice'), false);
  });
});
