import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetSpeedChatHomeCache } from '../../server/config/home.js';
import {
  ensureMcpSeed,
  callMcpTool,
  reloadMcp,
} from '../../server/mcp/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_NAMESPACED = 'mcp__fixture__echo';
const EXPECTED_CALL_RESULT = 'pong';

describe('MCP registry', () => {
  let homeDir;

  before(async () => {
    homeDir = path.join(__dirname, '../fixtures/mcp-home');
    process.env.SPEEDCHAT_HOME = homeDir;
    resetSpeedChatHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
    await ensureMcpSeed();
    await reloadMcp();
  });

  after(async () => {
    await reloadMcp();
    delete process.env.SPEEDCHAT_HOME;
    resetSpeedChatHomeCache();
  });

  test('seed creates context7 enabled', async () => {
    const index = JSON.parse(
      await fs.readFile(path.join(homeDir, 'mcp.json'), 'utf8'),
    );
    assert.equal(index.servers.context7.enabled, true);
    const ctx7 = JSON.parse(
      await fs.readFile(
        path.join(homeDir, 'mcp/servers/context7.json'),
        'utf8',
      ),
    );
    assert.equal(ctx7.id, 'context7');
  });

  test('fixture echo returns pong', async () => {
    const result = await callMcpTool(EXPECTED_NAMESPACED, { message: 'x' });
    assert.equal(result, EXPECTED_CALL_RESULT);
  });
});
