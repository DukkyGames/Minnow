import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveFileIconId,
  resolveFolderIconId,
} from '../../src/ui/file-type-icon-resolve.ts';

describe('file-type-icons (Material Icon Theme)', () => {
  it('resolves language and compound-extension icons like VS Code', () => {
    assert.equal(resolveFileIconId('src/app.ts', { light: false }), 'typescript');
    assert.equal(resolveFileIconId('bundle.js', { light: false }), 'javascript');
    assert.equal(resolveFileIconId('app.test.mjs', { light: false }), 'test-js');
    assert.equal(resolveFileIconId('skills-loader.test.ts', { light: false }), 'test-ts');
    assert.equal(resolveFileIconId('main.py', { light: false }), 'python');
    assert.equal(resolveFileIconId('data.json', { light: false }), 'json');
    assert.equal(resolveFileIconId('index.html', { light: false }), 'html');
    assert.equal(resolveFileIconId('DESIGN.md', { light: false }), 'markdown');
    assert.equal(resolveFileIconId('notes.txt', { light: false }), 'document');
  });

  it('resolves special filenames from the screenshot set', () => {
    assert.equal(resolveFileIconId('README.md', { light: false }), 'readme');
    assert.equal(resolveFileIconId('package.json', { light: false }), 'nodejs');
    assert.equal(resolveFileIconId('tsconfig.json', { light: false }), 'tsconfig');
    assert.equal(resolveFileIconId('vite.config.ts', { light: false }), 'vite');
    assert.equal(resolveFileIconId('.gitignore', { light: false }), 'git');
    assert.equal(resolveFileIconId('.env', { light: false }), 'tune');
    assert.equal(resolveFileIconId('LICENSE', { light: false }), 'license');
  });

  it('resolves named folders', () => {
    assert.equal(resolveFolderIconId('src', { light: false }), 'folder-src');
    assert.equal(resolveFolderIconId('node_modules', { light: false }), 'folder-node');
    assert.equal(
      resolveFolderIconId('src', { expanded: true, light: false }),
      'folder-src-open',
    );
    assert.equal(resolveFolderIconId('random-dir', { light: false }), 'folder');
  });
});
