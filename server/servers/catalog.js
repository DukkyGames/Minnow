/**
 * Built-in managed server catalog (SearXNG and future entries).
 */

import * as searxngProvisioner from './searxng.js';

/** @typedef {'python-venv'} ManagedServerKind */

/**
 * @typedef {object} ManagedServerDef
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {ManagedServerKind} kind
 * @property {number} defaultPort
 * @property {boolean} defaultAutoStart
 * @property {string} healthPath
 * @property {object} provisioner
 */

/** @type {Record<string, ManagedServerDef>} */
export const BUILTIN_SERVERS = {
  searxng: {
    id: 'searxng',
    label: 'SearXNG',
    description: 'Local privacy-focused metasearch for Deep Research and web search.',
    kind: 'python-venv',
    defaultPort: 8899,
    defaultAutoStart: true,
    healthPath: '/healthz',
    provisioner: searxngProvisioner,
  },
};

/**
 * @param {string} id
 * @returns {ManagedServerDef | undefined}
 */
export function getServerDef(id) {
  return BUILTIN_SERVERS[id];
}

/** @returns {ManagedServerDef[]} */
export function listServerDefs() {
  return Object.values(BUILTIN_SERVERS);
}
