import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { handleBoardTestingRequest } from '../../server/orchestrate/board-testing/middleware.js';

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      this.body = chunk ?? '';
    },
  };
}

describe('board-testing API dev gate', () => {
  test('returns 404 when MINNOW_DEBUG and MINNOW_TEST are unset', async () => {
    const savedDebug = process.env.MINNOW_DEBUG;
    const savedTest = process.env.MINNOW_TEST;
    delete process.env.MINNOW_DEBUG;
    delete process.env.MINNOW_TEST;
    try {
      const res = mockRes();
      const handled = await handleBoardTestingRequest(
        { method: 'GET' },
        res,
        '/api/orchestrate/board-testing/status',
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 404);
      assert.match(res.body, /Not found/);
    } finally {
      if (savedDebug === undefined) delete process.env.MINNOW_DEBUG;
      else process.env.MINNOW_DEBUG = savedDebug;
      if (savedTest === undefined) delete process.env.MINNOW_TEST;
      else process.env.MINNOW_TEST = savedTest;
    }
  });
});
