/**
 * Deterministic fixture handler for plugin loader tests.
 * @param {Record<string, unknown>} _args
 * @param {import('../../../../server/tools/plugin-context.js').PluginContext} _ctx
 */
export default async function handler(_args, _ctx) {
  return 'pong';
}
