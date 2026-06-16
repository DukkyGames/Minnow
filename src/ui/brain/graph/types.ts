/**
 * Shared types for Brain knowledge-graph and call-graph renderers.
 */

/** Visual / semantic kind for a graph vertex. */
export type GraphNodeKind = 'page' | 'tag' | 'symbol';

/** Edge relationship between graph vertices. */
export type GraphEdgeKind = 'wikilink' | 'tag' | 'calls';

/** One node in the force-directed graph (simulation mutates x/y/vx/vy). */
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sublabel?: string;
  /** Wiki page path when kind === 'page'. */
  path?: string;
  /** Code symbol id when kind === 'symbol'. */
  symbolId?: string;
  /** Lint orphan highlight flag. */
  orphan?: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

/** Directed edge between two node ids. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

/** Theme colors resolved from CSS custom properties. */
export interface ForceGraphTheme {
  stageBg: string;
  nodePage: string;
  nodePageMuted: string;
  nodeTag: string;
  nodeTagMuted: string;
  nodeSymbol: string;
  nodeSymbolMuted: string;
  nodeActive: string;
  nodeOrphan: string;
  nodeOrphanMuted: string;
  edge: string;
  edgeHighlight: string;
  label: string;
  labelMuted: string;
  glow: string;
}

/** User interaction callbacks from the canvas renderer. */
export interface ForceGraphCallbacks {
  onSelect?: (node: GraphNode | null) => void;
  onDoubleClick?: (node: GraphNode) => void;
  onHover?: (node: GraphNode | null) => void;
}

/** Options passed when creating a force graph instance. */
export interface ForceGraphOptions extends ForceGraphCallbacks {
  reducedMotion?: boolean;
  /** Soft cap before clustering message (default 250). */
  maxNodes?: number;
}

/** Result of pure graph builders. */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated?: boolean;
  hiddenCount?: number;
}
