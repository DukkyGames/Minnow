/**
 * Validation for ~/.minnow/tools/<id>/tool.json manifests.
 */

import { ALL_TOOL_IDS } from '../config/tool-ids.js';

/** Same id rules as skills. */
export const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const MAX_MANIFEST_BYTES = 32 * 1024;
export const MAX_PARAMETER_PROPERTIES = 50;

const VALID_CATEGORIES = new Set([
  'web',
  'utility',
  'files',
  'git',
  'code',
  'agents',
  'browser',
  'lsp',
]);

const RESERVED_FUNCTION_NAMES = new Set([
  ...ALL_TOOL_IDS,
  'web_search_ddg',
  'web_search_tavily',
]);

/**
 * @param {string} id
 */
export function validatePluginId(id) {
  if (!PLUGIN_ID_RE.test(id)) {
    throw new Error('Invalid plugin id (use lowercase letters, numbers, hyphens)');
  }
  if (id.startsWith('_')) {
    throw new Error('Plugin id cannot start with underscore');
  }
}

/**
 * @param {string} functionName
 */
export function validateFunctionName(functionName) {
  if (!/^[a-z][a-z0-9_]*$/.test(functionName)) {
    throw new Error(
      'functionName must be lowercase snake_case starting with a letter',
    );
  }
  if (RESERVED_FUNCTION_NAMES.has(functionName)) {
    throw new Error(`functionName "${functionName}" is reserved`);
  }
  if (functionName.startsWith('mcp__') || functionName.startsWith('plugin__')) {
    throw new Error('functionName cannot use reserved prefixes');
  }
}

/**
 * @param {unknown} raw
 * @param {string} folderName
 * @returns {import('./scan.js').PluginManifest}
 */
export function validateToolManifest(raw, folderName) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('tool.json must be a JSON object');
  }
  const row = /** @type {Record<string, unknown>} */ (raw);

  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const functionName =
    typeof row.functionName === 'string' ? row.functionName.trim() : '';
  const label = typeof row.label === 'string' ? row.label.trim() : '';
  const description =
    typeof row.description === 'string' ? row.description.trim() : '';
  const category = typeof row.category === 'string' ? row.category.trim() : 'utility';

  if (!id) throw new Error('tool.json: id is required');
  if (id !== folderName) {
    throw new Error(`tool.json id "${id}" must match folder "${folderName}"`);
  }
  validatePluginId(id);
  if (!functionName) throw new Error('tool.json: functionName is required');
  validateFunctionName(functionName);
  if (!label) throw new Error('tool.json: label is required');
  if (!description) throw new Error('tool.json: description is required');
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`tool.json: invalid category "${category}"`);
  }

  const parameters = row.parameters;
  if (!parameters || typeof parameters !== 'object') {
    throw new Error('tool.json: parameters object is required');
  }
  const paramsObj = /** @type {Record<string, unknown>} */ (parameters);
  if (paramsObj.type !== 'object') {
    throw new Error('tool.json: parameters.type must be "object"');
  }
  const props = paramsObj.properties;
  if (props && typeof props === 'object') {
    const count = Object.keys(/** @type {object} */ (props)).length;
    if (count > MAX_PARAMETER_PROPERTIES) {
      throw new Error(
        `tool.json: too many parameter properties (max ${MAX_PARAMETER_PROPERTIES})`,
      );
    }
  }

  let capabilities = {
    filesystem: false,
    network: false,
    nodeBuiltin: false,
  };
  if (row.capabilities && typeof row.capabilities === 'object') {
    const cap = /** @type {Record<string, unknown>} */ (row.capabilities);
    capabilities = {
      filesystem: cap.filesystem === true,
      network: cap.network === true,
      nodeBuiltin: cap.nodeBuiltin === true,
    };
  }

  return {
    id,
    functionName,
    label,
    description,
    category,
    parameters: /** @type {import('./scan.js').PluginManifest['parameters']} */ (
      parameters
    ),
    capabilities,
  };
}
