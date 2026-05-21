/**
 * Tests for Orchestrate plan path filtering and find_files output parsing.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isExecutableOrchestratePlan,
  normalizeOrchestratePlanPath,
} from '../../src/chat/orchestrate/plan-path.ts';
import {
  normalizePlanDiscoverError,
  parseFindFilesOutputPaths,
} from '../../src/chat/orchestrate/list-plans.ts';

describe('orchestrate plan-path', () => {
  test('accepts markdown under documentation/plans root', () => {
    assert.equal(
      isExecutableOrchestratePlan('documentation/plans/feature-foo.md'),
      true,
    );
    assert.equal(
      normalizeOrchestratePlanPath('documentation/plans/feature-foo.md'),
      'documentation/plans/feature-foo.md',
    );
  });

  test('accepts nested dirs outside references and verification', () => {
    assert.equal(
      isExecutableOrchestratePlan(
        'documentation/plans/Build out/step-01.md',
      ),
      true,
    );
  });

  test('rejects references subtree', () => {
    assert.equal(
      isExecutableOrchestratePlan('documentation/plans/references/mode-sources.md'),
      false,
    );
    assert.equal(
      normalizeOrchestratePlanPath(
        'documentation/plans/references/mode-sources.md',
      ),
      undefined,
    );
  });

  test('rejects verification subtree', () => {
    assert.equal(
      isExecutableOrchestratePlan(
        'documentation/plans/verification/step-05.md',
      ),
      false,
    );
  });

  test('rejects paths outside documentation/plans', () => {
    assert.equal(isExecutableOrchestratePlan('src/main.ts'), false);
    assert.equal(isExecutableOrchestratePlan('plans/foo.md'), false);
  });
});

describe('normalizePlanDiscoverError', () => {
  test('maps ENOENT to no_plans_dir', () => {
    assert.equal(
      normalizePlanDiscoverError(
        "ENOENT: no such file or directory, scandir 'C:\\workspace\\documentation\\plans'",
      ),
      'no_plans_dir',
    );
  });

  test('passes through other messages', () => {
    assert.equal(
      normalizePlanDiscoverError('pattern is required'),
      'pattern is required',
    );
  });
});

describe('parseFindFilesOutputPaths', () => {
  test('splits lines and ignores truncation footer', () => {
    const raw = `documentation/plans/a.md\ndocumentation/plans/b.md\n(truncated at 500 results)`;
    assert.deepEqual(parseFindFilesOutputPaths(raw), [
      'documentation/plans/a.md',
      'documentation/plans/b.md',
    ]);
  });

  test('returns empty for no files message', () => {
    assert.deepEqual(
      parseFindFilesOutputPaths(
        'No files matching "**/*.md" under documentation/plans',
      ),
      [],
    );
  });

  test('returns empty for Error prefix', () => {
    assert.deepEqual(parseFindFilesOutputPaths('Error: pattern is required'), []);
  });
});
