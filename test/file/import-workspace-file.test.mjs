import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { executeServerTool } from '../../server/runtime/tools-middleware.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

describe('import_workspace_file', () => {
  let homeDir;
  let workspaceDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-import-workspace-file');
    await ensureMinnowLayout();
    workspaceDir = path.join(homeDir, 'project');
    await fs.mkdir(workspaceDir, { recursive: true });
    await setWorkspaceRoot(workspaceDir);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  test('writes nested file bytes and creates parent folders', async () => {
    const content = Buffer.from('hello from drop\n', 'utf8').toString('base64');
    const { result } = await executeServerTool('import_workspace_file', {
      path: 'pkg/src/readme.txt',
      content,
    });
    assert.match(result, /Imported pkg\/src\/readme\.txt/);
    const body = await fs.readFile(path.join(workspaceDir, 'pkg', 'src', 'readme.txt'), 'utf8');
    assert.equal(body, 'hello from drop\n');
  });

  test('kind dir creates an empty directory', async () => {
    const { result } = await executeServerTool('import_workspace_file', {
      path: 'pkg/empty',
      kind: 'dir',
    });
    assert.match(result, /Imported directory pkg\/empty/);
    const stat = await fs.stat(path.join(workspaceDir, 'pkg', 'empty'));
    assert.equal(stat.isDirectory(), true);
  });
});
