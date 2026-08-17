/**
 * llama.cpp completion admission: priority classify + background semaphore.
 * Interactive must start while one background job holds the slot.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { writeLlamaCppConfig } from '../../server/models/llama-args.js';
import { getServesIndexPath } from '../../server/models/paths.js';
import {
  getServe,
  resetServesForTests,
  setServeBackgroundRunOverrideForTests,
  setServeHealthOverrideForTests,
  setServePidAliveOverrideForTests,
  setSubscribeRunOverrideForTests,
  startServe,
} from '../../server/models/serve.js';
import {
  admitLocalCompletion,
  classifyLocalCompletionPriority,
  resetLocalCompletionAdmissionForTests,
} from '../../server/providers/proxy.js';
import { LLAMA_CPP_LOCAL_ID } from '../../server/providers/store.js';

const LIB_CHAT = 'lib-chat';

async function waitForStatus(serveId, status, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const serve = await getServe(serveId);
    if (serve && serve.status === status) return serve;
    await new Promise((r) => setTimeout(r, 25));
  }
  return getServe(serveId);
}

describe('classifyLocalCompletionPriority', () => {
  test('persist, chatId, and non-utility roles are interactive', () => {
    assert.equal(classifyLocalCompletionPriority({ persist: true }), 'interactive');
    assert.equal(classifyLocalCompletionPriority({ chatId: 'chat-fixed-1' }), 'interactive');
    assert.equal(classifyLocalCompletionPriority({ fallbackRole: 'main-chat' }), 'interactive');
    assert.equal(classifyLocalCompletionPriority({ fallbackRole: 'sub-agent' }), 'interactive');
  });

  test('benchmark (no role), utility, titles, editor-completion, summarize are background', () => {
    assert.equal(classifyLocalCompletionPriority({ persist: false }), 'background');
    assert.equal(classifyLocalCompletionPriority({}), 'background');
    assert.equal(classifyLocalCompletionPriority({ fallbackRole: 'utility' }), 'background');
    assert.equal(classifyLocalCompletionPriority({ fallbackRole: 'chat-titles' }), 'background');
    assert.equal(classifyLocalCompletionPriority({ fallbackRole: 'goal-eval' }), 'background');
    assert.equal(classifyLocalCompletionPriority({ fallbackRole: 'editor-completion' }), 'background');
    assert.equal(classifyLocalCompletionPriority({ fallbackRole: 'context-summarize' }), 'background');
  });
});

describe('background semaphore vs interactive', () => {
  /** @type {string} */
  let homeDir;
  /** @type {string} */
  let modelPath;
  let runSeq = 0;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-completion-admit-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    modelPath = path.join(homeDir, 'chat-model.gguf');
    await fs.writeFile(modelPath, 'GGUF');
    const managedRoot = path.join(homeDir, 'models-runtime', 'llama-cpp');
    await fs.mkdir(managedRoot, { recursive: true });
    const binName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    await fs.writeFile(path.join(managedRoot, binName), '');
    await fs.writeFile(
      path.join(managedRoot, 'meta.json'),
      `${JSON.stringify({ variant: 'cpu', version: 'test', path: path.join(managedRoot, binName) })}\n`,
    );
  });

  beforeEach(async () => {
    await resetServesForTests();
    resetLocalCompletionAdmissionForTests();
    runSeq = 0;
    await fs.mkdir(path.dirname(getServesIndexPath()), { recursive: true });
    await fs.writeFile(getServesIndexPath(), `${JSON.stringify({ version: 1, serves: [] }, null, 2)}\n`);
    await writeLlamaCppConfig({ models_max: 3 });
    setServeHealthOverrideForTests(async () => true);
    setServeBackgroundRunOverrideForTests(async () => {
      runSeq += 1;
      return { runId: `admit-run-${runSeq}`, pid: 8000 + runSeq };
    });
    setSubscribeRunOverrideForTests(() => () => {});
    setServePidAliveOverrideForTests(() => true);
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await resetServesForTests();
    resetLocalCompletionAdmissionForTests();
    await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('interactive is admitted while one background job holds the semaphore', async () => {
    const serve = await startServe({
      modelPath,
      runtime: 'llama-cpp',
      libraryId: LIB_CHAT,
      llama: { parallel: 2 },
      async: true,
    });
    await waitForStatus(serve.id, 'running');

    const background = await admitLocalCompletion({
      providerId: LLAMA_CPP_LOCAL_ID,
      modelId: LIB_CHAT,
      priority: 'background',
    });
    assert.equal(background.baseUrl, serve.baseUrl);

    let interactiveDone = false;
    const interactive = admitLocalCompletion({
      providerId: LLAMA_CPP_LOCAL_ID,
      modelId: LIB_CHAT,
      priority: 'interactive',
    }).then((admission) => {
      interactiveDone = true;
      admission.release();
      return admission;
    });
    const interactiveAdmission = await interactive;
    assert.equal(interactiveDone, true);
    assert.equal(interactiveAdmission.baseUrl, serve.baseUrl);

    let secondBackgroundDone = false;
    const secondBackground = admitLocalCompletion({
      providerId: LLAMA_CPP_LOCAL_ID,
      modelId: LIB_CHAT,
      priority: 'background',
    }).then((admission) => {
      secondBackgroundDone = true;
      admission.release();
      return admission;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(secondBackgroundDone, false, 'second background must wait on the semaphore');
    background.release();
    await secondBackground;
    assert.equal(secondBackgroundDone, true);
  });
});
