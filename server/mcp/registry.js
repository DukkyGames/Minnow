/**
 * MCP server registry — load configs, connect clients, list/call tools.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getSpeedChatHome } from '../config/home.js';
import {
  BUILTIN_MCP_INDEX,
  CONTEXT7_SERVER,
  FIXTURE_SERVER,
} from './defaults.js';
import { toNamespacedName, toOpenAIDefinitions, parseNamespacedName } from './bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const clients = new Map();
const toolMaps = new Map();

function mcpHome() {
  return path.join(getSpeedChatHome(), 'mcp');
}

function resolveTransportCommand(transport) {
  const cmd = [...(transport.command ? [transport.command] : []), ...(transport.args ?? [])];
  return cmd.map((part) => {
    if (part === 'test/fixtures/mock-mcp-server.mjs') {
      return path.join(PROJECT_ROOT, 'test/fixtures/mock-mcp-server.mjs');
    }
    return part;
  });
}

/** In-process fixture client for deterministic tests (no stdio). */
function createFixtureClient() {
  return {
    async listTools() {
      return {
        tools: [
          {
            name: 'echo',
            description: 'Echo fixture',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string' } },
            },
          },
        ],
      };
    },
    async callTool() {
      return { content: [{ type: 'text', text: 'pong' }] };
    },
    async close() {},
  };
}

async function connectServer(serverId, config) {
  if (clients.has(serverId)) {
    return clients.get(serverId);
  }

  if (serverId === 'fixture') {
    const client = createFixtureClient();
    const map = new Map();
    map.set(toNamespacedName('fixture', 'echo'), {
      serverId: 'fixture',
      toolName: 'echo',
    });
    clients.set(serverId, client);
    toolMaps.set(serverId, map);
    return client;
  }

  const transportCfg = config.transport;
  if (!transportCfg || transportCfg.type !== 'stdio') {
    throw new Error(`Unsupported transport for ${serverId}`);
  }

  const command = resolveTransportCommand(transportCfg);
  const transport = new StdioClientTransport({
    command: command[0],
    args: command.slice(1),
    env: { ...process.env, ...(transportCfg.env ?? {}) },
    cwd: PROJECT_ROOT,
  });

  const client = new Client(
    { name: 'speedchat', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  const listed = await client.listTools();
  const tools = listed.tools ?? [];
  const map = new Map();
  for (const tool of tools) {
    map.set(toNamespacedName(serverId, tool.name), {
      serverId,
      toolName: tool.name,
    });
  }
  clients.set(serverId, client);
  toolMaps.set(serverId, map);
  return client;
}

/** Copy built-in MCP seeds on first run. */
export async function ensureMcpSeed() {
  const home = mcpHome();
  await fs.mkdir(path.join(home, 'servers'), { recursive: true });
  const indexPath = path.join(getSpeedChatHome(), 'mcp.json');
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(
      indexPath,
      `${JSON.stringify(BUILTIN_MCP_INDEX, null, 2)}\n`,
      'utf8',
    );
  }

  const seeds = [
    { name: 'context7.json', data: CONTEXT7_SERVER },
    { name: 'fixture.json', data: FIXTURE_SERVER },
    { name: 'README.md', data: null, text: '# MCP servers\n\nSet Context7 API key via provider secrets as context7ApiKey.\n' },
  ];

  for (const seed of seeds) {
    const dest = path.join(home, 'servers', seed.name);
    try {
      await fs.access(dest);
    } catch {
      if (seed.text) {
        await fs.writeFile(dest, seed.text, 'utf8');
      } else {
        await fs.writeFile(dest, `${JSON.stringify(seed.data, null, 2)}\n`, 'utf8');
      }
    }
  }
}

async function loadIndex() {
  const indexPath = path.join(getSpeedChatHome(), 'mcp.json');
  try {
    return JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch {
    return BUILTIN_MCP_INDEX;
  }
}

async function loadServerConfig(serverId) {
  const filePath = path.join(mcpHome(), 'servers', `${serverId}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function listServers() {
  const index = await loadIndex();
  const out = [];
  for (const [id, meta] of Object.entries(index.servers ?? {})) {
    out.push({
      id,
      enabled: meta.enabled !== false,
      connected: clients.has(id),
    });
  }
  return out;
}

export async function listEnabledMcpTools() {
  const index = await loadIndex();
  const defs = [];
  for (const [serverId, meta] of Object.entries(index.servers ?? {})) {
    if (meta.enabled === false) continue;
    try {
      const config = await loadServerConfig(serverId);
      if (config.enabled === false) continue;
      const client = await connectServer(serverId, config);
      const listed = await client.listTools();
      defs.push(...toOpenAIDefinitions(serverId, listed.tools ?? []));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`MCP server ${serverId} skipped: ${message}`);
    }
  }
  return defs;
}

export async function callMcpTool(namespacedName, args) {
  const parsed = parseNamespacedName(namespacedName);
  if (!parsed) {
    return `Error: invalid MCP tool name ${namespacedName}`;
  }

  const config = await loadServerConfig(parsed.serverId);
  if (config.id === 'context7') {
    const key = process.env.CONTEXT7_API_KEY ?? '';
    if (!key) {
      return 'Error: Context7 API key not configured. Set CONTEXT7_API_KEY or context7ApiKey in ~/.speedchat provider secrets.';
    }
  }

  await connectServer(parsed.serverId, config);
  const client = clients.get(parsed.serverId);
  const result = await client.callTool({
    name: parsed.toolName,
    arguments: args ?? {},
  });

  const parts = [];
  for (const block of result.content ?? []) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n') || 'OK';
}

export function isMcpToolName(name) {
  return name.startsWith('mcp__');
}

export async function reloadMcp() {
  for (const [, client] of clients) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  toolMaps.clear();
}
