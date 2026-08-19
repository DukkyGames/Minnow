/**
 * Workspace reference resolution (file panel → composer).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveWorkspaceReferences } from '../src/attachments/workspace-ref.ts';
import type { Attachment } from '../src/attachments/types.ts';

describe('resolveWorkspaceReferences', () => {
  it('reads workspace paths into text attachments', async () => {
    const input: Attachment[] = [
      {
        id: 'ws-1',
        name: 'foo.ts',
        kind: 'workspace',
        mimeType: 'application/x-minnow-workspace-file',
        size: 0,
        workspacePath: 'src/foo.ts',
      },
    ];

    const out = await resolveWorkspaceReferences(input, async (path) => `mock:${path}`);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'text');
    assert.equal(out[0].name, 'foo.ts');
    assert.equal(out[0].text, 'mock:src/foo.ts');
  });

  it('passes through non-workspace attachments unchanged', async () => {
    const textAttachment: Attachment = {
      id: 't-1',
      name: 'note.txt',
      kind: 'text',
      mimeType: 'text/plain',
      size: 4,
      text: 'hi',
    };

    const out = await resolveWorkspaceReferences([textAttachment], async () => {
      throw new Error('should not read');
    });
    assert.deepEqual(out, [textAttachment]);
  });

  it('marks read failures as error attachments', async () => {
    const input: Attachment[] = [
      {
        id: 'ws-missing',
        name: 'missing.ts',
        kind: 'workspace',
        mimeType: 'application/x-minnow-workspace-file',
        size: 0,
        workspacePath: 'src/missing.ts',
      },
    ];

    const out = await resolveWorkspaceReferences(input, async () => {
      throw new Error('ENOENT');
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'error');
    assert.match(out[0].error ?? '', /ENOENT/);
  });

  it('resolves workspace images to kind image with dataUrl', async () => {
    const input: Attachment[] = [
      {
        id: 'ws-img',
        name: 'logo.png',
        kind: 'workspace',
        mimeType: 'application/x-minnow-workspace-file',
        size: 0,
        workspacePath: 'assets/logo.png',
      },
    ];

    const out = await resolveWorkspaceReferences(
      input,
      async () => {
        throw new Error('read_file should not run for images');
      },
      async () => ({
        dataUrl: 'data:image/png;base64,abcd',
        mimeType: 'image/png',
        size: 4,
      }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'image');
    assert.equal(out[0].name, 'logo.png');
    assert.match(out[0].dataUrl ?? '', /^data:image\//);
    assert.equal(out[0].mimeType, 'image/png');
    assert.equal(out[0].size, 4);
  });

  it('marks image read failures as error attachments', async () => {
    const input: Attachment[] = [
      {
        id: 'ws-bad-img',
        name: 'missing.png',
        kind: 'workspace',
        mimeType: 'application/x-minnow-workspace-file',
        size: 0,
        workspacePath: 'assets/missing.png',
      },
    ];

    const out = await resolveWorkspaceReferences(
      input,
      async () => 'unused',
      async () => {
        throw new Error('HTTP 404');
      },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'error');
    assert.match(out[0].error ?? '', /HTTP 404/);
  });

  it('routes Excel workspace chips through read_document, not read_file', async () => {
    const input: Attachment[] = [
      {
        id: 'ws-xlsx',
        name: 'Comission Structure.xlsx',
        kind: 'workspace',
        mimeType: 'application/x-minnow-workspace-file',
        size: 0,
        workspacePath: 'Comission Structure.xlsx',
      },
    ];

    const out = await resolveWorkspaceReferences(
      input,
      async () => {
        throw new Error('read_file should not run for office documents');
      },
      async () => {
        throw new Error('image reader should not run for office documents');
      },
      async (path) => `extracted:${path}`,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'text');
    assert.equal(out[0].name, 'Comission Structure.xlsx');
    assert.equal(out[0].text, 'extracted:Comission Structure.xlsx');
  });

  it('routes PDF workspace chips through read_document', async () => {
    const input: Attachment[] = [
      {
        id: 'ws-pdf',
        name: 'brief.pdf',
        kind: 'workspace',
        mimeType: 'application/x-minnow-workspace-file',
        size: 0,
        workspacePath: 'docs/brief.pdf',
      },
    ];

    const out = await resolveWorkspaceReferences(
      input,
      async () => {
        throw new Error('read_file should not run for PDFs');
      },
      async () => {
        throw new Error('image reader should not run for PDFs');
      },
      async () => '--- brief.pdf (1 page(s)) ---\nHello',
    );
    assert.equal(out[0].kind, 'text');
    assert.match(out[0].text ?? '', /Hello/);
  });
});
