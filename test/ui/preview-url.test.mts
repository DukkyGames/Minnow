import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isAbsoluteFilePathInput,
  parsePreviewAddress,
  pathToFileUrl,
  tryUrlFromBareHost,
} from '../../src/ui/preview-url.ts';

describe('preview-url', () => {
  test('pathToFileUrl encodes Windows paths', () => {
    assert.equal(
      pathToFileUrl('C:\\Users\\dev\\index.html'),
      'file:///C:/Users/dev/index.html',
    );
  });

  test('parsePreviewAddress accepts https URLs', () => {
    assert.deepEqual(parsePreviewAddress('https://example.com'), {
      kind: 'url',
      url: 'https://example.com',
    });
  });

  test('parsePreviewAddress maps Windows paths when local files allowed', () => {
    const parsed = parsePreviewAddress('D:/project/page.html', { allowLocalFiles: true });
    assert.equal(parsed?.kind, 'url');
    if (parsed?.kind === 'url') {
      assert.equal(parsed.url, 'file:///D:/project/page.html');
    }
  });

  test('parsePreviewAddress treats bare paths as workspace-relative', () => {
    assert.deepEqual(parsePreviewAddress('src/index.html'), {
      kind: 'workspace',
      path: 'src/index.html',
    });
  });

  test('isAbsoluteFilePathInput detects drive letters', () => {
    assert.equal(isAbsoluteFilePathInput('C:\\tmp\\a.html'), true);
    assert.equal(isAbsoluteFilePathInput('docs/a.html'), false);
  });

  test('parsePreviewAddress promotes bare hostnames to https URLs', () => {
    assert.deepEqual(parsePreviewAddress('google.com'), {
      kind: 'url',
      url: 'https://google.com',
    });
    assert.deepEqual(parsePreviewAddress('www.google.com'), {
      kind: 'url',
      url: 'https://www.google.com',
    });
    assert.deepEqual(parsePreviewAddress('example.com/path?q=1'), {
      kind: 'url',
      url: 'https://example.com/path?q=1',
    });
    assert.deepEqual(parsePreviewAddress('mail.example.co.uk'), {
      kind: 'url',
      url: 'https://mail.example.co.uk',
    });
  });

  test('parsePreviewAddress treats localhost and IPv4 as http URLs', () => {
    assert.deepEqual(parsePreviewAddress('localhost:5173'), {
      kind: 'url',
      url: 'http://localhost:5173',
    });
    assert.deepEqual(parsePreviewAddress('127.0.0.1:8080/admin'), {
      kind: 'url',
      url: 'http://127.0.0.1:8080/admin',
    });
    assert.deepEqual(parsePreviewAddress('192.168.1.1'), {
      kind: 'url',
      url: 'https://192.168.1.1',
    });
  });

  test('parsePreviewAddress keeps file-looking paths as workspace', () => {
    assert.deepEqual(parsePreviewAddress('index.html'), {
      kind: 'workspace',
      path: 'index.html',
    });
    assert.deepEqual(parsePreviewAddress('src/foo.ts'), {
      kind: 'workspace',
      path: 'src/foo.ts',
    });
    // Unknown TLD-like extension — treat as a file, not a host.
    assert.deepEqual(parsePreviewAddress('readme.md'), {
      kind: 'workspace',
      path: 'readme.md',
    });
  });

  test('tryUrlFromBareHost returns null for non-host inputs', () => {
    assert.equal(tryUrlFromBareHost('index.html'), null);
    assert.equal(tryUrlFromBareHost('src/foo.ts'), null);
    assert.equal(tryUrlFromBareHost('node_modules'), null);
    assert.equal(tryUrlFromBareHost('https://example.com'), null);
    assert.equal(tryUrlFromBareHost(''), null);
  });
});
