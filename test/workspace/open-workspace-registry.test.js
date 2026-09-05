import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.MINNOW_TEST = '1';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-openws-home-'));
process.env.MINNOW_HOME = home;

const {
  closeWorkspace,
  isOpenWorkspace,
  listOpenWorkspaces,
  openWorkspace,
  resetOpenWorkspaces,
} = await import('../../server/workspace/open-workspaces.js');
const { isAllowedWorkspaceRoot, isAllowedWorkspaceRootAsync } = await import(
  '../../server/chats-workspace/paths.js'
);
const { setWorkspaceRoot, initWorkspaceRoot } = await import(
  '../../server/workspace/root.js'
);

let root;
let repoA;
let repoB;
let stranger;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-openws-'));
  repoA = path.join(root, 'repo-a');
  repoB = path.join(root, 'repo-b');
  stranger = path.join(root, 'stranger');
  await fs.mkdir(repoA, { recursive: true });
  await fs.mkdir(repoB, { recursive: true });
  await fs.mkdir(stranger, { recursive: true });
  await initWorkspaceRoot();
  await setWorkspaceRoot(repoA);
});

after(async () => {
  resetOpenWorkspaces();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  resetOpenWorkspaces();
});

describe('open-workspace registry', () => {
  test('a folder is open only between open and close', () => {
    assert.equal(isOpenWorkspace(repoB), false);
    openWorkspace(repoB);
    assert.equal(isOpenWorkspace(repoB), true);
    assert.equal(closeWorkspace(repoB), true);
    assert.equal(isOpenWorkspace(repoB), false);
  });

  test('refcounts, so a second view does not un-register the first', () => {
    openWorkspace(repoB);
    openWorkspace(repoB);
    assert.equal(closeWorkspace(repoB), false);
    assert.equal(isOpenWorkspace(repoB), true);
    assert.equal(closeWorkspace(repoB), true);
    assert.equal(isOpenWorkspace(repoB), false);
  });

  test('lists open folders, most recently opened first', () => {
    openWorkspace(repoA);
    openWorkspace(repoB);
    const listed = listOpenWorkspaces().map((entry) => entry.path);
    assert.equal(listed.length, 2);
    assert.equal(path.resolve(listed[0]), path.resolve(repoB));
  });

  test('closing a folder nobody opened is a no-op, not a throw', () => {
    assert.equal(closeWorkspace(stranger), true);
    assert.equal(closeWorkspace(''), false);
  });

  test('rejects an empty path rather than registering nothing', () => {
    assert.throws(() => openWorkspace(''), /required/);
  });
});

describe('allowlist membership', () => {
  test('admits open folders and only open folders', async () => {
    // Not open, not the workspace, not in the MRU.
    assert.equal(isAllowedWorkspaceRoot(stranger), false);

    openWorkspace(stranger);
    assert.equal(isAllowedWorkspaceRoot(stranger), true);
    assert.equal(await isAllowedWorkspaceRootAsync(stranger), true);

    closeWorkspace(stranger);
    assert.equal(isAllowedWorkspaceRoot(stranger), false);
  });

  test('two real project folders pass at the same time', () => {
    openWorkspace(repoA);
    openWorkspace(repoB);
    assert.equal(isAllowedWorkspaceRoot(repoA), true);
    assert.equal(isAllowedWorkspaceRoot(repoB), true);
  });
});
