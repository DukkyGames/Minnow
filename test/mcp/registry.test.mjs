import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  ensureMcpSeed,
  callMcpTool,
  reloadMcp,
  createMcpServer,
  deleteMcpServer,
  listServers,
} from '../../server/mcp/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_NAMESPACED = 'mcp__fixture__echo';
const EXPECTED_CALL_RESULT = 'pong';

describe('MCP registry', () => {
  let homeDir;

  before(async () => {
    homeDir = path.join(__dirname, '../fixtures/mcp-home');
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
    await ensureMcpSeed();
    await reloadMcp();
  });

  after(async () => {
    await reloadMcp();
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
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

  test('dispatch sends the server spelling for snake_case and dashed tools', async () => {
    await createMcpServer({
      id: 'stdio-fixture',
      label: 'Stdio fixture',
      description: 'Name round-trip fixture',
      enabled: true,
      transport: {
        type: 'stdio',
        command: process.execPath,
        args: ['test/fixtures/mock-mcp-server.mjs'],
      },
    });

    try {
      // Regression: `browser_navigate` used to be dispatched as `browser-navigate`.
      assert.equal(
        await callMcpTool('mcp__stdio-fixture__echo_message', { message: 'x' }),
        'called:echo_message',
      );
      // Dashed names (Context7 style) encode to the same shape and still resolve.
      assert.equal(
        await callMcpTool('mcp__stdio-fixture__echo_dashed', { message: 'x' }),
        'called:echo-dashed',
      );
      assert.match(
        await callMcpTool('mcp__stdio-fixture__not_a_tool', {}),
        /has no tool "not_a_tool"\. Available tools: echo, echo_message, echo-dashed/,
      );
    } finally {
      await deleteMcpServer('stdio-fixture');
    }
  });

  test('create and delete custom MCP server', async () => {
    const created = await createMcpServer({
      id: 'custom-test',
      label: 'Custom test',
      description: 'Test server',
      enabled: false,
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['-e', 'process.exit(0)'],
      },
    });
    assert.equal(created?.id, 'custom-test');

    const listed = await listServers();
    assert.ok(listed.some((s) => s.id === 'custom-test'));

    await deleteMcpServer('custom-test');
    const after = await listServers();
    assert.ok(!after.some((s) => s.id === 'custom-test'));
  });

  test('cannot create reserved MCP server id', async () => {
    await assert.rejects(
      () =>
        createMcpServer({
          id: 'context7',
          label: 'Bad',
          transport: { type: 'stdio', command: 'node', args: [] },
        }),
      /reserved/,
    );
  });
});
