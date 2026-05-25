/**
 * @param {Record<string, unknown>} args
 * @param {import('../plugin-context.js').PluginContext} ctx
 * @returns {Promise<string>}
 */
export default async function handler(args, ctx) {
  const name = typeof args.name === 'string' ? args.name : 'world';
  ctx.log(`greet called for ${name}`);
  return `Hello, ${name}`;
}
