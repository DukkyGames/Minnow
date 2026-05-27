import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseToolArguments,
  TOOL_ARGUMENTS_EMPTY,
  TOOL_ARGUMENTS_INVALID_JSON,
} from '../../src/tools/parse-tool-arguments.ts';

describe('parseToolArguments', () => {
  it('parses valid JSON object', () => {
    const { args, parseError } = parseToolArguments('{"path":"/tmp"}');
    assert.deepEqual(args, { path: '/tmp' });
    assert.equal(parseError, undefined);
  });

  it('returns empty args for blank input', () => {
    const { args, parseError } = parseToolArguments('  ');
    assert.deepEqual(args, {});
    assert.equal(parseError, undefined);
  });

  it('legacy mode returns {} on invalid JSON', () => {
    const { args, parseError } = parseToolArguments('{bad');
    assert.deepEqual(args, {});
    assert.equal(parseError, undefined);
  });

  it('constrained mode surfaces error on invalid JSON', () => {
    const { args, parseError } = parseToolArguments('{bad', { constrained: true });
    assert.deepEqual(args, {});
    assert.equal(parseError, TOOL_ARGUMENTS_INVALID_JSON);
  });

  it('constrained mode surfaces error on blank arguments', () => {
    const { args, parseError } = parseToolArguments('  ', { constrained: true });
    assert.deepEqual(args, {});
    assert.equal(parseError, TOOL_ARGUMENTS_EMPTY);
  });
});
