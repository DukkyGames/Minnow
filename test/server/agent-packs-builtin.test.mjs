import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  BUILTIN_AGENT_PACK_ID,
  BUILTIN_AGENT_PACK_ZIP_FILENAME,
  BUILTIN_AGENT_PACK_ZIP_ROOT,
  buildBuiltinAgentPackFileMap,
  buildBuiltinAgentPackZip,
} from '../../server/agent-packs/builtin-pack.js';
import { handleAgentPacksRequest } from '../../server/agent-packs/routes.js';
import { validatePackManifest } from '../../server/agent-packs/validate.js';
import { writeTemplateFiles } from '../../server/agent-packs/template.js';

const projectRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const builtinIds = new Set([
  'default',
  'general',
  'desktop',
  'planner',
  'orchestrator',
  'builder',
  'verifier',
  'tester',
  'reviewer',
  'researcher',
  'ui-designer',
  'expert-panel',
]);

describe('agent-packs builtin export', () => {
  test('buildBuiltinAgentPackFileMap includes shipped work agents', async () => {
    const files = await buildBuiltinAgentPackFileMap(projectRoot);
    assert.ok(files['manifest.json']);
    assert.ok(files['prompts/builder.full.md']);
    assert.ok(files['prompts/planner.full.md']);

    const manifest = JSON.parse(files['manifest.json']);
    assert.equal(manifest.id, BUILTIN_AGENT_PACK_ID);
    assert.ok(manifest.agents.length >= 7);
    assert.ok(manifest.agents.some((agent) => agent.key === 'builder'));
  });

  test('exported manifest passes pack validation on disk', async () => {
    const files = await buildBuiltinAgentPackFileMap(projectRoot);
    const tempRoot = await mkdtemp(join(tmpdir(), 'minnow-builtin-pack-'));
    const packRoot = join(tempRoot, BUILTIN_AGENT_PACK_ID);

    try {
      await writeTemplateFiles(packRoot, files);
      const manifest = JSON.parse(files['manifest.json']);
      const result = validatePackManifest(manifest, packRoot, builtinIds);
      assert.equal(result.ok, true, result.errors?.join('; '));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('buildBuiltinAgentPackZip extracts with system tar', async () => {
    const zip = await buildBuiltinAgentPackZip(projectRoot);
    const tempRoot = await mkdtemp(join(tmpdir(), 'minnow-builtin-pack-zip-'));
    const zipPath = join(tempRoot, BUILTIN_AGENT_PACK_ZIP_FILENAME);
    await writeFile(zipPath, zip);

    try {
      const listing = execFileSync('tar', ['-tf', zipPath], { encoding: 'utf8' });
      assert.match(listing, new RegExp(`${BUILTIN_AGENT_PACK_ZIP_ROOT}/manifest\\.json`));
      assert.match(listing, new RegExp(`${BUILTIN_AGENT_PACK_ZIP_ROOT}/prompts/builder\\.full\\.md`));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('GET /api/agent-packs/builtin returns application/zip', async () => {
    /** @type {Record<string, string | number>} */
    const headers = {};
    let body = Buffer.alloc(0);

    const req = { method: 'GET', url: '/api/agent-packs/builtin' };
    const res = {
      statusCode: 0,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(chunk) {
        body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      },
    };

    const handled = await handleAgentPacksRequest(req, res, '/api/agent-packs/builtin');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(headers['content-type'], 'application/zip');
    assert.match(String(headers['content-disposition']), /minnow-default-agent-pack\.zip/);
    assert.equal(body.readUInt32LE(0), 0x04034b50);
  });
});
