import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import { installAgentPackFromZip } from '../../server/agent-packs/install.js';
import { handleAgentPacksRequest } from '../../server/agent-packs/routes.js';
import { scanAgentPacks } from '../../server/agent-packs/scan.js';
import { buildAgentPackTemplateZip } from '../../server/agent-packs/template.js';

const builtinIds = new Set(['default', 'builder', 'planner']);

let tempHome = '';

before(async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'minnow-agent-pack-upload-'));
  process.env.MINNOW_HOME = tempHome;
  resetMinnowHomeCache();
});

after(async () => {
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
});

function buildMultipartBody(filename, fileBuffer, boundary = '----minnow-pack-upload') {
  const header = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: application/zip',
    '',
    '',
  ].join('\r\n');
  const footer = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([Buffer.from(header, 'utf8'), fileBuffer, Buffer.from(footer, 'utf8')]);
}

describe('agent-packs upload', () => {
  test('installAgentPackFromZip installs template zip to manifest id folder', async () => {
    const zip = buildAgentPackTemplateZip();
    const result = await installAgentPackFromZip(zip);

    assert.equal(result.packId, 'my-pack');
    assert.ok(result.filesWritten >= 3);
    assert.match(result.packRoot, /agent-packs[\\/]my-pack$/);

    const manifestRaw = await readFile(join(result.packRoot, 'manifest.json'), 'utf8');
    assert.match(manifestRaw, /"id": "my-pack"/);

    const packs = await scanAgentPacks(process.cwd(), builtinIds);
    const installed = packs.find((p) => p.id === 'my-pack');
    assert.ok(installed);
    assert.equal(installed.valid, true);
    assert.equal(installed.agents.length, 1);
  });

  test('installAgentPackFromZip rejects archives without manifest.json', async () => {
    const { createStoreZip } = await import('../../server/agent-packs/template.js');
    const zip = createStoreZip([
      { name: 'readme.txt', data: Buffer.from('hello', 'utf8') },
    ]);

    await assert.rejects(
      () => installAgentPackFromZip(zip),
      /manifest\.json/i,
    );
  });

  test('POST /api/agent-packs/upload accepts multipart zip', async () => {
    const zip = buildAgentPackTemplateZip();
    const boundary = '----minnow-upload-test';
    const body = buildMultipartBody('my-pack.zip', zip, boundary);

    /** @type {Record<string, string | number>} */
    const headers = {};
    let responseBody = '';

    const req = {
      method: 'POST',
      url: '/api/agent-packs/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      on(event, handler) {
        if (event === 'data') handler(body);
        if (event === 'end') handler();
      },
    };

    const res = {
      statusCode: 0,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(chunk) {
        responseBody = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
      },
    };

    const handled = await handleAgentPacksRequest(req, res, '/api/agent-packs/upload');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(headers['content-type'], 'application/json');

    const parsed = JSON.parse(responseBody);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.packId, 'my-pack');
    assert.ok(parsed.pack);
    assert.equal(parsed.pack.valid, true);
  });

  test('POST /api/agent-packs/upload rejects non-zip filenames', async () => {
    const zip = buildAgentPackTemplateZip();
    const boundary = '----minnow-upload-bad-ext';
    const body = buildMultipartBody('pack.tar.gz', zip, boundary);

    const req = {
      method: 'POST',
      url: '/api/agent-packs/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      on(event, handler) {
        if (event === 'data') handler(body);
        if (event === 'end') handler();
      },
    };

    const res = {
      statusCode: 0,
      setHeader() {},
      end(chunk) {
        this.body = String(chunk ?? '');
      },
    };

    await handleAgentPacksRequest(req, res, '/api/agent-packs/upload');
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /\.zip file/i);
  });
});
