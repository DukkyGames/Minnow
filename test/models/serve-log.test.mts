/**
 * llama-server log parsing — progress, severity, and load phase.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyLogLine,
  describeLoadPhase,
  parseLoadProgress,
  toLogLines,
} from '../../src/models/serve-log.ts';

describe('parseLoadProgress', () => {
  test('reads a percentage the runtime printed', () => {
    assert.equal(parseLoadProgress('load_tensors: loading model, progress = 9.17 %'), 9.17);
  });

  test('reads the fractional form', () => {
    assert.equal(parseLoadProgress('progress = 0.25'), 25);
  });

  test('takes the most recent value', () => {
    const log = ['loading 10.00 %', 'loading 42.50 %'].join('\n');
    assert.equal(parseLoadProgress(log), 42.5);
  });

  test('returns null rather than inventing a number', () => {
    assert.equal(parseLoadProgress('llama_model_loader: loaded meta data'), null);
    assert.equal(parseLoadProgress(''), null);
  });

  test('rejects out-of-range values', () => {
    assert.equal(parseLoadProgress('loading 480 %'), null);
  });
});

describe('classifyLogLine', () => {
  test('tags severities', () => {
    assert.equal(classifyLogLine('[ERROR] failed to load model'), 'error');
    assert.equal(classifyLogLine('warning: deprecated flag'), 'warn');
    assert.equal(classifyLogLine('[DEBUG] slot state'), 'debug');
    assert.equal(classifyLogLine('server is listening on port 8085'), 'info');
    assert.equal(classifyLogLine('....'), 'plain');
  });
});

describe('describeLoadPhase', () => {
  test('names the phase the log is in', () => {
    assert.equal(describeLoadPhase(''), 'Starting runtime');
    assert.equal(describeLoadPhase('load_tensors: offloading 48 layers'), 'Loading weights');
    assert.equal(describeLoadPhase('llama_context: kv_size = 4096'), 'Allocating context');
    assert.equal(describeLoadPhase('main: server is listening'), 'Warming up');
  });
});

describe('toLogLines', () => {
  test('caps history so a long-running server cannot grow the DOM forever', () => {
    const text = Array.from({ length: 800 }, (_, i) => `line ${i}`).join('\n');
    const lines = toLogLines(text, 100);
    assert.equal(lines.length, 100);
    assert.equal(lines.at(-1), 'line 799');
  });
});
