/**
 * MCP server registry — load configs, connect clients, list/call tools.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getMinnowHome } from '../config/home.js';
import {
  BUILTIN_MCP_INDEX,
  CONTEXT7_SERVER,
  FIXTURE_SERVER,
} from './defaults.js';
import { toNamespacedName, toOpenAIDefinitions, parseNamespacedName } from './bridge.js';
import {
  RESERVED_MCP_SERVER_IDS,
  validateCreateMcpServerBody,
  validateMcpServerId,
} from './validate.js';
import { getContext7ApiKey, resolveMcpTransportEnv } from './secrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const clients = new Map();
const toolMaps = new Map();

function mcpHome() {
  return path.join(getMinnowHome(), 'mcp');
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

/**
 * Cache namespaced id → the server's own tool name, so dispatch never has to
 * guess it back out of the lossy encoding.
 * @param {string} serverId
 * @param {Array<{ name: string }>} tools
 */
function rememberTools(serverId, tools) {
  const map = new Map();
  for (const tool of tools ?? []) {
    const key = toNamespacedName(serverId, tool.name);
    // `get-docs` and `get_docs` encode to the same id; the first listing wins.
    if (!map.has(key)) map.set(key, tool.name);
  }
  toolMaps.set(serverId, map);
  return map;
}

/**
 * Real tool name for a namespaced id, preferring the live listing over the
 * lossy decode. Returns `null` when the server does not expose the tool.
 * @param {string} namespacedName
 * @param {{ serverId: string, toolName: string }} parsed
 */
function resolveMcpToolName(namespacedName, parsed) {
  const map = toolMaps.get(parsed.serverId);
  if (!map) return { toolName: parsed.toolName, known: [] };
  return { toolName: map.get(namespacedName) ?? null, known: [...map.values()] };
}

async function connectServer(serverId, config) {
  if (clients.has(serverId)) {
    return clients.get(serverId);
  }

  if (serverId === 'fixture') {
    const client = createFixtureClient();
    const listed = await client.listTools();
    rememberTools(serverId, listed.tools ?? []);
    clients.set(serverId, client);
    return client;
  }

  const transportCfg = config.transport;
  if (!transportCfg || transportCfg.type !== 'stdio') {
    throw new Error(`Unsupported transport for ${serverId}`);
  }

  const command = resolveTransportCommand(transportCfg);
  const resolvedEnv = await resolveMcpTransportEnv(transportCfg.env);
  const transport = new StdioClientTransport({
    command: command[0],
    args: command.slice(1),
    env: { ...process.env, ...resolvedEnv },
    cwd: PROJECT_ROOT,
  });

  const client = new Client(
    { name: 'minnow', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  const listed = await client.listTools();
  rememberTools(serverId, listed.tools ?? []);
  clients.set(serverId, client);
  return client;
}

/** Copy built-in MCP seeds on first run. */
export async function ensureMcpSeed() {
  const home = mcpHome();
  await fs.mkdir(path.join(home, 'servers'), { recursive: true });
  const indexPath = path.join(getMinnowHome(), 'mcp.json');
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
    { name: 'README.md', data: null, text: '# MCP servers\n\nSet the Context7 API key in Settings → MCP or save it to mcp/secrets.json.\n' },
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
  const indexPath = path.join(getMinnowHome(), 'mcp.json');
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
    let label = id;
    let description = '';
    let builtin = false;
    try {
      const config = await loadServerConfig(id);
      label = config.label ?? id;
      description = config.description ?? '';
      builtin = config.builtin === true;
    } catch {
      /* config file missing — index entry only */
    }
    out.push({
      id,
      label,
      description,
      builtin,
      enabled: meta.enabled !== false,
      connected: clients.has(id),
    });
  }
  return out;
}

/**
 * Connect every enabled server and collect its live tool listing.
 * Servers that fail to start are returned with `error` set rather than dropped,
 * so callers can tell "no tools" apart from "never connected".
 */
async function collectEnabledServerTools() {
  const index = await loadIndex();
  const out = [];
  for (const [serverId, meta] of Object.entries(index.servers ?? {})) {
    if (meta.enabled === false) continue;
    const entry = { id: serverId, label: serverId, tools: [], error: null };
    try {
      const config = await loadServerConfig(serverId);
      entry.label = config.label ?? serverId;
      if (config.enabled === false) continue;
      const client = await connectServer(serverId, config);
      const listed = await client.listTools();
      entry.tools = listed.tools ?? [];
      // Re-listing can differ from connect time; keep the dispatch map current.
      rememberTools(serverId, entry.tools);
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    }
    out.push(entry);
  }
  return out;
}

export async function listEnabledMcpTools() {
  const defs = [];
  for (const server of await collectEnabledServerTools()) {
    if (server.error) {
      console.warn(`MCP server ${server.id} skipped: ${server.error}`);
      continue;
    }
    defs.push(...toOpenAIDefinitions(server.id, server.tools));
  }
  return defs;
}

/**
 * Per-server tool listing for Settings → Tools: namespaced ids for permission
 * rows, without the JSON schemas the model-facing definitions carry.
 */
export async function listMcpToolCatalog() {
  const servers = await collectEnabledServerTools();
  return servers.map((server) => ({
    id: server.id,
    label: server.label,
    error: server.error,
    tools: server.tools.map((tool) => ({
      name: tool.name,
      namespacedName: toNamespacedName(server.id, tool.name),
      description: tool.description ?? '',
    })),
  }));
}

export async function callMcpTool(namespacedName, args) {
  const parsed = parseNamespacedName(namespacedName);
  if (!parsed) {
    return `Error: invalid MCP tool name ${namespacedName}`;
  }

  const config = await loadServerConfig(parsed.serverId);
  if (config.id === 'context7') {
    const key = await getContext7ApiKey();
    if (!key) {
      return 'Error: Context7 API key not configured. Set it in Settings → MCP or export CONTEXT7_API_KEY.';
    }
  }

  await connectServer(parsed.serverId, config);
  const client = clients.get(parsed.serverId);
  const { toolName, known } = resolveMcpToolName(namespacedName, parsed);
  if (!toolName) {
    const available = known.length > 0 ? known.join(', ') : 'none';
    return `Error: MCP server "${parsed.serverId}" has no tool "${parsed.toolName}". Available tools: ${available}`;
  }

  const result = await client.callTool({
    name: toolName,
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

async function writeIndex(index) {
  const indexPath = path.join(getMinnowHome(), 'mcp.json');
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

/**
 * Register a custom stdio MCP server (writes config + index entry).
 * @param {unknown} body
 */
export async function createMcpServer(body) {
  await ensureMcpSeed();
  const payload = validateCreateMcpServerBody(body);
  const index = await loadIndex();
  if (index.servers?.[payload.id]) {
    throw new Error('MCP server already exists');
  }

  const config = {
    id: payload.id,
    label: payload.label,
    description: payload.description,
    transport: payload.transport,
    enabled: payload.enabled,
    builtin: false,
  };

  const filePath = path.join(mcpHome(), 'servers', `${payload.id}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  index.servers = index.servers ?? {};
  index.servers[payload.id] = {
    enabled: payload.enabled,
    configFile: `servers/${payload.id}.json`,
  };
  await writeIndex(index);
  await reloadMcp();
  return listServers().then((servers) => servers.find((s) => s.id === payload.id));
}

/**
 * Remove a user-added MCP server (built-ins cannot be deleted).
 * @param {string} serverId
 */
export async function deleteMcpServer(serverId) {
  const id = validateMcpServerId(serverId);
  if (RESERVED_MCP_SERVER_IDS.has(id)) {
    throw new Error('Cannot delete a built-in MCP server');
  }

  const index = await loadIndex();
  if (!index.servers?.[id]) {
    throw new Error('Unknown MCP server');
  }

  let builtin = false;
  try {
    const config = await loadServerConfig(id);
    builtin = config.builtin === true;
  } catch {
    /* missing config — allow delete of orphan index entry */
  }
  if (builtin) {
    throw new Error('Cannot delete a built-in MCP server');
  }

  delete index.servers[id];
  await writeIndex(index);

  const filePath = path.join(mcpHome(), 'servers', `${id}.json`);
  try {
    await fs.unlink(filePath);
  } catch {
    /* file may already be missing */
  }

  await reloadMcp();
}
