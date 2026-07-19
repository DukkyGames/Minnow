import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  AGENT_PACK_TEMPLATE_ZIP_ROOT,
  buildAgentPackTemplateZip,
  getAgentPackTemplateFileMap,
} from '../../server/agent-packs/template.js';
import { handleAgentPacksRequest } from '../../server/agent-packs/routes.js';

describe('agent-packs template', () => {
  test('getAgentPackTemplateFileMap includes manifest and prompts', () => {
    const files = getAgentPackTemplateFileMap({ packId: 'demo' });
    assert.ok(files['manifest.json']);
    assert.ok(files['prompts/example.full.md']);
    assert.match(files['manifest.json'], /"id": "demo"/);
  });

  test('buildAgentPackTemplateZip returns a valid zip archive', () => {
    const zip = buildAgentPackTemplateZip();
    assert.ok(Buffer.isBuffer(zip));
    assert.ok(zip.length > 100);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const tail = zip.subarray(-22);
    assert.equal(tail.readUInt32LE(0), 0x06054b50);
    const zipText = zip.toString('utf8');
    assert.match(zipText, new RegExp(`${AGENT_PACK_TEMPLATE_ZIP_ROOT}/manifest.json`));
  });

  test('buildAgentPackTemplateZip extracts with system tar', async () => {
    const zip = buildAgentPackTemplateZip();
    const tempRoot = await mkdtemp(join(tmpdir(), 'minnow-agent-pack-zip-'));
    const zipPath = join(tempRoot, 'template.zip');
    await writeFile(zipPath, zip);

    try {
      const listing = execFileSync('tar', ['-tf', zipPath], { encoding: 'utf8' });
      assert.match(listing, new RegExp(`${AGENT_PACK_TEMPLATE_ZIP_ROOT}/manifest\\.json`));
      assert.match(listing, new RegExp(`${AGENT_PACK_TEMPLATE_ZIP_ROOT}/prompts/example\\.full\\.md`));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('GET /api/agent-packs/template returns application/zip', async () => {
    /** @type {Record<string, string | number>} */
    const headers = {};
    let body = Buffer.alloc(0);

    const req = { method: 'GET', url: '/api/agent-packs/template' };
    const res = {
      statusCode: 0,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(chunk) {
        body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      },
    };

    const handled = await handleAgentPacksRequest(req, res, '/api/agent-packs/template');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(headers['content-type'], 'application/zip');
    assert.match(String(headers['content-disposition']), /minnow-agent-pack-template\.zip/);
    assert.equal(body.readUInt32LE(0), 0x04034b50);
  });
});
