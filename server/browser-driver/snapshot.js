/**
 * P5-A — Accessibility-tree snapshot with stable uids (MIN-719).
 *
 * Restored from `server/cdp/snapshot.js` (deleted in 86cc513f), originally
 * ported from opencode-browser (MIT). One change: the uid counter is per-call
 * instead of module-level, so two concurrent sessions cannot interleave uids.
 *
 * This is the driver's primary read path. It is deliberately not a screenshot:
 * the issue's known hazard is that screenshot round-trips hang, so nothing that
 * asserts depends on one.
 */

/** @typedef {import('./cdp-client.js').CdpClient} CdpClient */

/**
 * @typedef {object} SnapshotNode
 * @property {number} uid
 * @property {string} role
 * @property {string} name
 * @property {string} [value]
 * @property {number} backendNodeId
 * @property {SnapshotNode[]} [children]
 *
 * @typedef {object} Snapshot
 * @property {SnapshotNode[]} nodes
 * @property {Map<number, SnapshotNode>} byUid
 * @property {string} text
 */

/**
 * @param {unknown} field CDP AXValue
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
 * Walk one AX node into zero or more snapshot nodes.
 *
 * Returns an **array**, not a single node, because a node can be dropped while
 * its children survive. The version of this that shipped before returned `null`
 * for any ignored, unnamed node — and Chromium's `<html>` wrapper is exactly
 * that, so the whole document below it was discarded and every snapshot came
 * back as a lone `RootWebArea`. Ignored nodes are hoisted, never pruned.
 *
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

  // Reserve the uid before descending so parents number before their children.
  const uid = counter.next++;

  /** @type {SnapshotNode[]} */
  const children = [];
  const childIds = /** @type {string[]} */ (axNode.childIds ?? []);
  for (const childId of childIds) {
    const childAx = allNodes[childId];
    if (!childAx) continue;
    children.push(...walkAXTree(childAx, allNodes, byUid, counter, seen));
  }

  // Structural nodes the accessibility layer ignores carry no meaning of their
  // own; their children take their place.
  if (ignored && !name) return children;

  // Collapse anonymous single-child wrappers so the rendered tree stays readable.
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
 * Indented `[uid] role "name"` rendering.
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
 * Build a snapshot from a raw `Accessibility.getFullAXTree` result. Pure, so the
 * tree shaping is testable without a browser.
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
