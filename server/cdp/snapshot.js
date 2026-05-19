/**
 * Accessibility-tree snapshots with stable UIDs for click/fill.
 * Ported from opencode-browser (MIT).
 */

/** @typedef {import('./client.js').CDPClient} CDPClient */

/**
 * @typedef {object} SnapshotNode
 * @property {number} uid
 * @property {string} role
 * @property {string} name
 * @property {string} [value]
 * @property {number} backendNodeId
 * @property {SnapshotNode[]} [children]
 */

/**
 * @typedef {object} Snapshot
 * @property {SnapshotNode[]} nodes
 * @property {Map<number, SnapshotNode>} byUid
 * @property {string} text
 */

let nextUid = 1;

/**
 * @param {Record<string, unknown>} axNode
 * @param {Record<string, Record<string, unknown>>} allNodes
 * @param {Map<number, SnapshotNode>} byUid
 * @returns {SnapshotNode | null}
 */
function walkAXTree(axNode, allNodes, byUid) {
  const role =
    /** @type {string} */ (
      (axNode.role && typeof axNode.role === 'object'
        ? /** @type {{ value?: string }} */ (axNode.role).value
        : '') ?? ''
    );
  const name =
    /** @type {string} */ (
      (axNode.name && typeof axNode.name === 'object'
        ? /** @type {{ value?: string }} */ (axNode.name).value
        : '') ?? ''
    );
  const value =
    axNode.value && typeof axNode.value === 'object'
      ? /** @type {{ value?: string }} */ (axNode.value).value
      : undefined;
  const backendNodeId = /** @type {number} */ (axNode.backendDOMNodeId ?? 0);
  const ignored = Boolean(axNode.ignored);

  if (ignored && !name) return null;

  const uid = nextUid++;
  const children = [];

  const childIds = /** @type {string[]} */ (axNode.childIds ?? []);
  for (const childId of childIds) {
    const childAx = allNodes[childId];
    if (!childAx) continue;
    const childNode = walkAXTree(childAx, allNodes, byUid);
    if (childNode) children.push(childNode);
  }

  if (!name && !value && (role === 'generic' || role === 'none') && children.length <= 1) {
    return children[0] ?? null;
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
  return node;
}

/**
 * @param {SnapshotNode[]} nodes
 * @param {number} [indent]
 */
function renderTree(nodes, indent = 0) {
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
 * @param {CDPClient} client
 * @returns {Promise<Snapshot>}
 */
export async function takeSnapshot(client) {
  nextUid = 1;

  const result = await client.send('Accessibility.getFullAXTree');
  const axNodes = /** @type {Array<Record<string, unknown>> | undefined} */ (result.nodes);

  if (!axNodes || axNodes.length === 0) {
    return { nodes: [], byUid: new Map(), text: '(empty page)' };
  }

  const indexed = {};
  for (const node of axNodes) {
    indexed[String(node.nodeId)] = node;
  }

  const byUid = new Map();
  const roots = [];
  const rootNode = walkAXTree(axNodes[0], indexed, byUid);
  if (rootNode) roots.push(rootNode);

  return { nodes: roots, byUid, text: renderTree(roots) };
}

/**
 * @param {Snapshot} snapshot
 * @param {number} uid
 */
export function resolveUid(snapshot, uid) {
  return snapshot.byUid.get(uid);
}
