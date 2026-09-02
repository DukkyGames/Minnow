/** @typedef {import('./cdp-client.js').CdpClient} CdpClient */

/**
 * @typedef {object} SnapshotNode
 * @property {number} uid
 * @property {string} role
 * @property {string} name
 * @property {string} [value]
 * @property {number} backendNodeId
 * @property {SnapshotNode[]} [children]
 * @typedef {object} Snapshot
 * @property {SnapshotNode[]} nodes
 * @property {Map<number, SnapshotNode>} byUid
 * @property {string} text
 */

/**
 * @param {unknown} field
 * @returns {string}
 */
function axValue(field) {
  if (field && typeof field === 'object' && 'value' in field) {
    const v = /** @type {{ value?: unknown }} */ (field).value;
    return v == null ? '' : String(v);
  }
  return '';
}

/**
 * @param {Record<string, unknown>} axNode
 * @param {Record<string, Record<string, unknown>>} allNodes
 * @param {Map<number, SnapshotNode>} byUid
 * @param {{ next: number }} counter
 * @param {Set<string>} seen
 * @returns {SnapshotNode[]}
 */
function walkAXTree(axNode, allNodes, byUid, counter, seen) {
  const nodeKey = String(axNode.nodeId);
  if (seen.has(nodeKey)) return [];
  seen.add(nodeKey);

  const role = axValue(axNode.role);
  const name = axValue(axNode.name);
  const rawValue = axValue(axNode.value);
  const value = rawValue === '' ? undefined : rawValue;
  const backendNodeId = Number(axNode.backendDOMNodeId ?? 0);
  const ignored = Boolean(axNode.ignored);

  const uid = counter.next++;

  /** @type {SnapshotNode[]} */
  const children = [];
  const childIds = /** @type {string[]} */ (axNode.childIds ?? []);
  for (const childId of childIds) {
    const childAx = allNodes[childId];
    if (!childAx) continue;
    children.push(...walkAXTree(childAx, allNodes, byUid, counter, seen));
  }

  if (ignored && !name) return children;

  if (!name && !value && (role === 'generic' || role === 'none' || role === '') && children.length <= 1) {
    return children;
  }

  /** @type {SnapshotNode} */
  const node = {
    uid,
    role,
    name,
    backendNodeId,
    ...(value !== undefined ? { value } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
  byUid.set(uid, node);
  return [node];
}

/**
 * @param {SnapshotNode[]} nodes
 * @param {number} [indent]
 * @returns {string}
 */
export function renderTree(nodes, indent = 0) {
  /** @type {string[]} */
  const lines = [];
  for (const node of nodes) {
    const pad = ' '.repeat(indent);
    const parts = [`[${node.uid}]`, node.role];
    if (node.name) parts.push(`"${node.name}"`);
    if (node.value) parts.push(`value="${node.value}"`);
    lines.push(`${pad}${parts.join(' ')}`);
    if (node.children) lines.push(renderTree(node.children, indent + 1));
  }
  return lines.join('\n');
}

/**
 * @param {Array<Record<string, unknown>> | undefined} axNodes
 * @returns {Snapshot}
 */
export function buildSnapshot(axNodes) {
  if (!axNodes || axNodes.length === 0) {
    return { nodes: [], byUid: new Map(), text: '(empty page)' };
  }
  /** @type {Record<string, Record<string, unknown>>} */
  const indexed = {};
  for (const node of axNodes) indexed[String(node.nodeId)] = node;

  /** @type {Map<number, SnapshotNode>} */
  const byUid = new Map();
  const counter = { next: 1 };
  const seen = new Set();
  const roots = walkAXTree(axNodes[0], indexed, byUid, counter, seen);

  return { nodes: roots, byUid, text: roots.length ? renderTree(roots) : '(empty page)' };
}

/**
 * @param {CdpClient} client
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Snapshot>}
 */
export async function takeSnapshot(client, opts = {}) {
  const result = await client.send('Accessibility.getFullAXTree', {}, opts);
  return buildSnapshot(/** @type {any} */ (result.nodes));
}

/**
 * @param {Snapshot} snapshot
 * @param {number} uid
 * @returns {SnapshotNode | undefined}
 */
export function resolveUid(snapshot, uid) {
  return snapshot.byUid.get(uid);
}
