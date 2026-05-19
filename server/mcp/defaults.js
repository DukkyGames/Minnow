/**
 * Built-in MCP server seeds (Context7 default enabled).
 */

export const BUILTIN_MCP_INDEX = {
  version: 1,
  servers: {
    context7: {
      enabled: true,
      configFile: 'servers/context7.json',
    },
    fixture: {
      enabled: true,
      configFile: 'servers/fixture.json',
    },
  },
};

export const CONTEXT7_SERVER = {
  id: 'context7',
  label: 'Context7',
  description: 'Up-to-date library documentation and code examples',
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
    env: {
      CONTEXT7_API_KEY: '${secret:context7ApiKey}',
    },
  },
  enabled: true,
  builtin: true,
};

export const FIXTURE_SERVER = {
  id: 'fixture',
  label: 'Fixture MCP (tests)',
  description: 'Deterministic echo tool for automated tests',
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['test/fixtures/mock-mcp-server.mjs'],
  },
  enabled: true,
  builtin: true,
};
