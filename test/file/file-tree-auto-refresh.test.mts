/**
 * Tests for debounced file tree refresh after mutating tool results.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  FILE_TREE_AUTO_REFRESH_DEBOUNCE_MS,
  resetFileTreeAutoRefreshForTests,
  scheduleFileTreeRefreshAfterTool,
  setFileTreeAutoRefreshRunnerForTests,
  shouldScheduleFileTreeRefresh,
} from '../../src/ui/file-tree-auto-refresh.ts';
import { setFileTreeServerAvailable } from '../../src/ui/file-tree-server.ts';

afterEach(() => {
  resetFileTreeAutoRefreshForTests();
  setFileTreeServerAvailable(false);
});

describe('shouldScheduleFileTreeRefresh', () => {
  test('true for mutating tool with success content when server is up', () => {
    setFileTreeServerAvailable(true);
    assert.equal(
      shouldScheduleFileTreeRefresh('save_file', { content: 'Wrote file.' }),
      true,
    );
    assert.equal(
      shouldScheduleFileTreeRefresh('make_directory', { content: 'Created dir' }),
      true,
    );
  });

  test('false when file tree server is unavailable', () => {
    setFileTreeServerAvailable(false);
    assert.equal(
      shouldScheduleFileTreeRefresh('save_file', { content: 'ok' }),
      false,
    );
  });

  test('false for non-mutating tools', () => {
    setFileTreeServerAvailable(true);
    assert.equal(shouldScheduleFileTreeRefresh('read_file', { content: 'body' }), false);
    assert.equal(shouldScheduleFileTreeRefresh('list_directory', { content: 'a\nb' }), false);
  });

  test('false when content starts with Error:', () => {
    setFileTreeServerAvailable(true);
    assert.equal(
      shouldScheduleFileTreeRefresh('save_file', { content: 'Error: denied' }),
      false,
    );
  });
});

describe('scheduleFileTreeRefreshAfterTool', () => {
  test('debounces two rapid schedules into one runner invocation', async () => {
    setFileTreeServerAvailable(true);
    let refreshCount = 0;
    setFileTreeAutoRefreshRunnerForTests(async () => {
      refreshCount += 1;
    });

    scheduleFileTreeRefreshAfterTool('save_file', { content: 'ok' });
    scheduleFileTreeRefreshAfterTool('save_file', { content: 'ok' });
    assert.equal(refreshCount, 0);

    await new Promise<void>((resolve) =>
      setTimeout(resolve, FILE_TREE_AUTO_REFRESH_DEBOUNCE_MS + 40),
    );
    assert.equal(refreshCount, 1);
  });
});
