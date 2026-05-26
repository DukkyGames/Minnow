import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  extractJavaScriptFromModelText,
  fizzBuzzLinePasses,
  jsonStdoutPasses,
  parseRunJavascriptToolOutput,
} from '../../src/benchmark/coding-code.ts';

describe('coding code extract and verify', () => {
  test('extractJavaScriptFromModelText reads fenced block', () => {
    const text = 'Here:\n```javascript\nconsole.log("wonnim");\n```';
    assert.equal(extractJavaScriptFromModelText(text), 'console.log("wonnim");');
  });

  test('fizzBuzzLinePasses accepts correct stdout', () => {
    const line =
      '1, 2, Fizz, 4, Buzz, Fizz, 7, 8, Fizz, Buzz, 11, Fizz, 13, 14, FizzBuzz';
    assert.equal(fizzBuzzLinePasses(line), true);
  });

  test('jsonStdoutPasses parses swapped keys', () => {
    assert.equal(jsonStdoutPasses('{"b":2,"a":1}'), true);
  });

  test('parseRunJavascriptToolOutput reads stdout and exit code', () => {
    const raw = 'node -e (exit 0)\n\nstdout:\n55\n\nstderr:\n';
    const parsed = parseRunJavascriptToolOutput(raw);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.stdout, '55');
  });
});
