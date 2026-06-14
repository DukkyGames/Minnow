/**
 * STT limits and multipart parsing tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  formatByteLimit,
  isAllowedAudioMime,
  resolveSttLimits,
} from '../../server/stt/limits.js';
import { extractFileFromMultipart } from '../../server/stt/multipart.js';
import { normalizeVoiceConfig } from '../../server/config/validators.js';

describe('stt limits', () => {
  test('formatByteLimit renders megabytes', () => {
    assert.equal(formatByteLimit(25 * 1024 * 1024), '25 MB');
  });

  test('isAllowedAudioMime accepts webm and rejects unknown', () => {
    assert.equal(isAllowedAudioMime('audio/webm'), true);
    assert.equal(isAllowedAudioMime('audio/webm;codecs=opus'), true);
    assert.equal(isAllowedAudioMime('application/pdf'), false);
    assert.ok(ALLOWED_AUDIO_MIME_TYPES.has('audio/wav'));
  });

  test('resolveSttLimits reads voice config caps', () => {
    const voice = normalizeVoiceConfig({
      limits: { maxAudioBytes: 1024, maxDurationSeconds: 30 },
    });
    const limits = resolveSttLimits(voice);
    assert.equal(limits.maxAudioBytes, 1024);
    assert.equal(limits.maxDurationSeconds, 30);
  });
});

describe('stt multipart', () => {
  test('extractFileFromMultipart parses a single file field', () => {
    const boundary = 'abc123';
    const audio = Buffer.from('fake-audio-bytes');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        'Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n',
      ),
      Buffer.from('Content-Type: audio/webm\r\n\r\n'),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const parsed = extractFileFromMultipart(body, boundary, 1024 * 1024);
    assert.equal(parsed.mime, 'audio/webm');
    assert.deepEqual(parsed.buffer, audio);
  });

  test('extractFileFromMultipart rejects oversize payloads', () => {
    const boundary = 'xyz';
    const audio = Buffer.alloc(20);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        'Content-Disposition: form-data; name="file"; filename="a.webm"\r\n',
      ),
      Buffer.from('Content-Type: audio/webm\r\n\r\n'),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    assert.throws(
      () => extractFileFromMultipart(body, boundary, 10),
      /exceeds/,
    );
  });
});
