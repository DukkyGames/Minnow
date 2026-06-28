/**
 * d3-force canvas graph renderer with zoom, drag, pan, and theme-aware drawing.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { drag } from 'd3-drag';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { scheduleAnimationFrame } from '../../../lib/schedule-animation-frame';
import type {
  ForceGraphCallbacks,
  ForceGraphOptions,
  ForceGraphTheme,
  GraphEdge,
  GraphNode,
} from './types';

export interface ForceGraphApi {
  setData(nodes: GraphNode[], edges: GraphEdge[]): void;
  selectNode(id: string | null): void;
  setHoverNode(id: string | null): void;
  fitToView(): void;
  /** Fit the viewport to a subset of nodes (or all nodes when `ids` is omitted). */
  fitToNodes(ids?: Set<string>): void;
  /** Pan to a specific node while preserving the current zoom level. */
  centerOnNode(id: string): void;
  /** Zoom to a node's neighborhood and make that highlight sticky (design brief "focus subtree"). */
  focusNode(id: string): void;
  /** Remove the sticky focus highlight; reverts to normal selection highlight. */
  clearFocus(): void;
  zoomBy(factor: number): void;
  resize(): void;
  destroy(): void;
  getTransform(): ZoomTransform;
}

type SimNode = GraphNode & SimulationNodeDatum;
type SimEdge = SimulationLinkDatum<SimNode> & { kind: GraphEdge['kind']; id: string };

/** Read Brain graph theme tokens from the document root. */
export function readForceGraphTheme(root: HTMLElement = document.documentElement): ForceGraphTheme {
  const style = getComputedStyle(root);
  const pick = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    stageBg: pick('--brain-stage-bg', pick('--mn-bg', 'oklch(97% 0 0)')),
    nodePage: pick('--brain-node-page', 'oklch(55% 0.08 250)'),
    nodePageMuted: pick('--brain-node-page-muted', pick('--brain-node-page', 'oklch(55% 0.08 250)')),
    nodeTag: pick('--brain-node-tag', 'oklch(62% 0.1 155)'),
    nodeTagMuted: pick('--brain-node-tag-muted', pick('--brain-node-tag', 'oklch(62% 0.1 155)')),
    nodeSymbol: pick('--brain-node-symbol', 'oklch(58% 0.12 285)'),
    nodeSymbolMuted: pick(
      '--brain-node-symbol-muted',
      pick('--brain-node-symbol', 'oklch(58% 0.12 285)'),
    ),
    nodeActive: pick('--brain-node-active', 'oklch(45% 0.14 250)'),
    nodeOrphan: pick('--brain-node-orphan', 'oklch(62% 0.16 25)'),
    nodeOrphanMuted: pick(
      '--brain-node-orphan-muted',
      pick('--brain-node-orphan', 'oklch(62% 0.16 25)'),
    ),
    edge: pick('--brain-edge', 'oklch(70% 0.02 250 / 0.45)'),
    edgeHighlight: pick('--brain-edge-hi', 'oklch(50% 0.06 250 / 0.85)'),
    label: pick('--mn-fg', 'oklch(32% 0.02 250)'),
    labelMuted: pick('--mn-fg-muted', 'oklch(52% 0.02 250)'),
    glow: pick('--brain-glow', 'oklch(55% 0.12 250 / 0.35)'),
  };
}

/** Create an interactive force-directed graph on a canvas element. */
export function createForceGraph(
  canvas: HTMLCanvasElement,
  options: ForceGraphOptions = {},
): ForceGraphApi {
  const reducedMotion =
    options.reducedMotion ??
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const callbacks: ForceGraphCallbacks = options;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d context unavailable');

  let theme = readForceGraphTheme();
  let nodes: SimNode[] = [];
  let edges: SimEdge[] = [];
  let simulation: Simulation<SimNode, SimEdge> | null = null;
  let transform: ZoomTransform = zoomIdentity;
  let selectedId: string | null = null;
  let hoverId: string | null = null;
  let highlightIds: Set<string> | null = null;
  // When set, the highlight is sticky (double-click "focus subtree") rather than transient.
  let focusId: string | null = null;
  // Signals that the next simulation end should auto-fit the viewport.
  let pendingFit = false;
  let edgeReveal = reducedMotion ? 1 : 0;
  let rafId = 0;
  let destroyed = false;

  const dpr = () => window.devicePixelRatio || 1;

  const resizeCanvas = (): void => {
    const rect = canvas.getBoundingClientRect();
    const ratio = dpr();
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const nodeRadius = (node: GraphNode): number => {
    if (node.kind === 'tag') return 5;
    if (node.kind === 'symbol') return 7;
    return 8;
  };

  const nodeColor = (node: GraphNode, dimmed = false): string => {
    if (node.id === selectedId) return theme.nodeActive;
    if (node.orphan) return dimmed ? theme.nodeOrphanMuted : theme.nodeOrphan;
    if (node.kind === 'tag') return dimmed ? theme.nodeTagMuted : theme.nodeTag;
    if (node.kind === 'symbol') return dimmed ? theme.nodeSymbolMuted : theme.nodeSymbol;
    return dimmed ? theme.nodePageMuted : theme.nodePage;
  };

  const screenToGraph = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - transform.x) / transform.k;
    const y = (clientY - rect.top - transform.y) / transform.k;
    return { x, y };
  };

  const pickNode = (clientX: number, clientY: number): GraphNode | null => {
    const { x, y } = screenToGraph(clientX, clientY);
    let best: GraphNode | null = null;
    let bestDist = Infinity;
    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;
      const r = nodeRadius(node) + 4;
      const dx = node.x - x;
      const dy = node.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 < bestDist) {
        best = node;
        bestDist = d2;
      }
    }
    return best;
  };

  /**
   * Circle/rect intersection used to pick label positions that avoid nearby nodes.
   */
  const circleIntersectsRect = (
    cx: number,
    cy: number,
    radius: number,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
  ): boolean => {
    const nearestX = Math.max(rx, Math.min(cx, rx + rw));
    const nearestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nearestX;
    const dy = cy - nearestY;
    return dx * dx + dy * dy <= radius * radius;
  };

  /**
   * Rounded label bubble path helper for the node callout card.
   */
  const addRoundedRectPath = (
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void => {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  /**
   * Pick a label position that stays in view and avoids node overlaps.
   */
  const placeLabelBubble = (
    node: SimNode,
    boxWidth: number,
    boxHeight: number,
    viewWidth: number,
    viewHeight: number,
  ): { x: number; y: number } => {
    const gap = 12;
    const margin = 8;
    const r = nodeRadius(node);
    const minX = (-transform.x) / transform.k + margin;
    const minY = (-transform.y) / transform.k + margin;
    const maxX = (viewWidth - transform.x) / transform.k - margin - boxWidth;
    const maxY = (viewHeight - transform.y) / transform.k - margin - boxHeight;
    const loX = Math.min(minX, maxX);
    const hiX = Math.max(minX, maxX);
    const loY = Math.min(minY, maxY);
    const hiY = Math.max(minY, maxY);
    const clamp = (value: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, value));

    const candidates = [
      { x: node.x! - boxWidth / 2, y: node.y! + r + gap, weight: 0 },
      { x: node.x! - boxWidth / 2, y: node.y! - r - gap - boxHeight, weight: 1 },
      { x: node.x! + r + gap, y: node.y! - boxHeight / 2, weight: 2 },
      { x: node.x! - r - gap - boxWidth, y: node.y! - boxHeight / 2, weight: 3 },
    ];

    let best = { x: candidates[0].x, y: candidates[0].y, score: Number.POSITIVE_INFINITY };
    for (const candidate of candidates) {
      const x = clamp(candidate.x, loX, hiX);
      const y = clamp(candidate.y, loY, hiY);
      const shiftPenalty = Math.hypot(x - candidate.x, y - candidate.y);
      let overlapPenalty = 0;
      for (const other of nodes) {
        if (other.id === node.id || other.x == null || other.y == null) continue;
        const intersects = circleIntersectsRect(
          other.x,
          other.y,
          nodeRadius(other) + 2,
          x - 4,
          y - 4,
          boxWidth + 8,
          boxHeight + 8,
        );
        if (intersects) overlapPenalty += 1;
      }
      const score = overlapPenalty * 120 + shiftPenalty * 2 + candidate.weight;
      if (score < best.score) best = { x, y, score };
    }
    return { x: best.x, y: best.y };
  };

  const draw = (): void => {
    if (destroyed || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = theme.stageBg;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const activeHighlight = highlightIds ?? (hoverId ? computeNeighborSet(hoverId) : null);

    for (const edge of edges) {
      const s = edge.source as SimNode;
      const t = edge.target as SimNode;
      if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
      const hi =
        activeHighlight &&
        activeHighlight.has(s.id) &&
        activeHighlight.has(t.id);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = hi ? theme.edgeHighlight : theme.edge;
      ctx.globalAlpha = reducedMotion ? 1 : 0.35 + edgeReveal * 0.65;
      ctx.lineWidth = hi ? 1.6 : 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const node of nodes) {
      if (node.x == null || node.y == null) continue;
      const r = nodeRadius(node);
      const active = node.id === selectedId;
      const dimmed =
        activeHighlight && !activeHighlight.has(node.id) && (focusId || hoverId || selectedId);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor(node, Boolean(dimmed));
      ctx.globalAlpha = 1;
      ctx.fill();
      if (active) {
        // Keep selection obvious regardless of motion preference.
        ctx.save();
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = theme.glow;
        ctx.lineWidth = 1.75;
        ctx.stroke();
      }
      ctx.strokeStyle = active ? theme.nodeActive : dimmed ? theme.edge : theme.edgeHighlight;
      ctx.lineWidth = active ? 1.5 : dimmed ? 0.65 : 0.75;
      ctx.stroke();
    }

    const labelNode = nodes.find((n) => n.id === (hoverId ?? selectedId));
    if (labelNode && labelNode.x != null && labelNode.y != null) {
      const titleFont = '600 12px system-ui, sans-serif';
      const sublabelFont = '500 10px ui-monospace, monospace';
      const titleLineHeight = 14;
      const sublabelLineHeight = 12;
      const lineGap = 4;
      const padX = 10;
      const padY = 8;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = titleFont;
      const titleWidth = ctx.measureText(labelNode.label).width;
      let sublabelWidth = 0;
      if (labelNode.sublabel) {
        ctx.font = sublabelFont;
        sublabelWidth = ctx.measureText(labelNode.sublabel).width;
      }

      const boxWidth = Math.max(136, Math.ceil(Math.max(titleWidth, sublabelWidth) + padX * 2));
      const boxHeight =
        padY * 2 +
        titleLineHeight +
        (labelNode.sublabel ? lineGap + sublabelLineHeight : 0);
      const boxPos = placeLabelBubble(labelNode, boxWidth, boxHeight, w, h);

      addRoundedRectPath(boxPos.x, boxPos.y, boxWidth, boxHeight, 8);
      ctx.fillStyle = theme.stageBg;
      ctx.globalAlpha = 0.94;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.edgeHighlight;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = titleFont;
      ctx.fillStyle = theme.label;
      ctx.fillText(labelNode.label, boxPos.x + padX, boxPos.y + padY);
      if (labelNode.sublabel) {
        ctx.font = sublabelFont;
        ctx.fillStyle = theme.labelMuted;
        ctx.fillText(
          labelNode.sublabel,
          boxPos.x + padX,
          boxPos.y + padY + titleLineHeight + lineGap,
        );
      }
    }

    ctx.restore();
  };

  const computeNeighborSet = (id: string): Set<string> => {
    const set = new Set<string>([id]);
    for (const e of edges) {
      const s = e.source as SimNode;
      const t = e.target as SimNode;
      if (s.id === id) set.add(t.id);
      if (t.id === id) set.add(s.id);
    }
    return set;
  };

  const tickLoop = (): void => {
    if (destroyed) return;
    if (!reducedMotion && edgeReveal < 1) edgeReveal = Math.min(1, edgeReveal + 0.04);
    draw();
    rafId = requestAnimationFrame(tickLoop);
  };

  // Compute bounding box and fit the viewport to a subset of nodes (or all when ids omitted).
  const fitToNodes = (ids?: Set<string>): void => {
    const target = ids ? nodes.filter((n) => ids.has(n.id)) : nodes;
    if (!target.length) {
      transform = zoomIdentity;
      select(canvas).call(zoomBehavior.transform, zoomIdentity);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of target) {
      if (n.x == null || n.y == null) continue;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    if (!isFinite(minX)) return;
    const rect = canvas.getBoundingClientRect();
    const pad = 48;
    const gw = Math.max(1, maxX - minX);
    const gh = Math.max(1, maxY - minY);
    const k = Math.min((rect.width - pad * 2) / gw, (rect.height - pad * 2) / gh, 2.5);
    const tx = rect.width / 2 - ((minX + maxX) / 2) * k;
    const ty = rect.height / 2 - ((minY + maxY) / 2) * k;
    transform = zoomIdentity.translate(tx, ty).scale(k);
    select(canvas).call(zoomBehavior.transform, transform);
  };

  // Pan to a specific node while preserving the current zoom level.
  const centerOnNode = (id: string): void => {
    const node = nodes.find((n) => n.id === id);
    if (!node || node.x == null || node.y == null) return;
    const rect = canvas.getBoundingClientRect();
    const k = transform.k;
    const tx = rect.width / 2 - node.x * k;
    const ty = rect.height / 2 - node.y * k;
    transform = zoomIdentity.translate(tx, ty).scale(k);
    select(canvas).call(zoomBehavior.transform, transform);
  };

  const restartSimulation = (): void => {
    simulation?.stop();
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    simulation = forceSimulation(nodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance((l) => (l.kind === 'tag' ? 48 : l.kind === 'calls' ? 72 : 64))
          .strength(0.55),
      )
      .force('charge', forceManyBody().strength(-145))
      .force('center', forceCenter(cx, cy))
      // Wider collision padding keeps bubbles from stacking in dense neighborhoods.
      .force('collide', forceCollide<SimNode>().radius((d) => nodeRadius(d) + 10))
      .alpha(reducedMotion ? 0 : 0.9)
      .alphaDecay(reducedMotion ? 1 : 0.04);

    if (reducedMotion) {
      simulation.tick(120);
      // For reduced motion, nodes are positioned synchronously — fit immediately.
      if (pendingFit) {
        pendingFit = false;
        fitToNodes();
      }
    } else {
      // Fit the viewport once the simulation has fully cooled.
      simulation.on('end', () => {
        if (pendingFit) {
          pendingFit = false;
          fitToNodes();
        }
      });
    }
  };

  const zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.15, 4])
    .on('zoom', (event) => {
      transform = event.transform;
    });

  select(canvas).call(zoomBehavior);

  let draggingNode: SimNode | null = null;

  const dragBehavior = drag<HTMLCanvasElement, unknown>()
    .filter((event) => {
      if (event.button !== 0) return false;
      const target = pickNode(event.sourceEvent.clientX, event.sourceEvent.clientY);
      return Boolean(target);
    })
    .on('start', (event) => {
      const target = pickNode(event.sourceEvent.clientX, event.sourceEvent.clientY);
      if (!target) return;
      draggingNode = target as SimNode;
      draggingNode.fx = draggingNode.x;
      draggingNode.fy = draggingNode.y;
      simulation?.alphaTarget(0.25).restart();
      select(canvas).on('.zoom', null);
    })
    .on('drag', (event) => {
      if (!draggingNode) return;
      const pt = screenToGraph(event.sourceEvent.clientX, event.sourceEvent.clientY);
      draggingNode.fx = pt.x;
      draggingNode.fy = pt.y;
    })
    .on('end', () => {
      if (draggingNode) {
        draggingNode.fx = draggingNode.x ?? null;
        draggingNode.fy = draggingNode.y ?? null;
      }
      draggingNode = null;
      simulation?.alphaTarget(0);
      select(canvas).call(zoomBehavior);
    });

  select(canvas).call(dragBehavior);

  let lastClick = { id: '', at: 0 };

  canvas.addEventListener('click', (ev) => {
    const node = pickNode(ev.clientX, ev.clientY);
    const now = Date.now();
    if (
      node &&
      node.id === lastClick.id &&
      now - lastClick.at < 320
    ) {
      callbacks.onDoubleClick?.(node);
      lastClick = { id: '', at: 0 };
      return;
    }
    lastClick = node ? { id: node.id, at: now } : { id: '', at: 0 };
    // Background click clears persistent focus.
    if (!node) focusId = null;
    selectedId = node?.id ?? null;
    highlightIds = selectedId ? computeNeighborSet(selectedId) : null;
    callbacks.onSelect?.(node);
  });

  canvas.addEventListener('mousemove', (ev) => {
    const node = pickNode(ev.clientX, ev.clientY);
    const nextId = node?.id ?? null;
    if (nextId === hoverId) return;
    hoverId = nextId;
    canvas.style.cursor = node ? 'pointer' : 'grab';
    callbacks.onHover?.(node);
  });

  canvas.addEventListener('mouseleave', () => {
    hoverId = null;
    canvas.style.cursor = 'grab';
    callbacks.onHover?.(null);
  });

  const themeObserver = new MutationObserver(() => {
    theme = readForceGraphTheme();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class'],
  });

  // Observe canvas layout changes and redraw without restarting the simulation.
  const scheduleCanvasResize = scheduleAnimationFrame(() => {
    resizeCanvas();
    draw();
  });
  const resizeObserver = new ResizeObserver(scheduleCanvasResize);
  resizeObserver.observe(canvas);

  // Clear focus when Escape is pressed anywhere in the document.
  const handleKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      focusId = null;
      highlightIds = selectedId ? computeNeighborSet(selectedId) : null;
    }
  };
  document.addEventListener('keydown', handleKeydown);

  resizeCanvas();
  rafId = requestAnimationFrame(tickLoop);

  const api: ForceGraphApi = {
    setData(rawNodes, rawEdges) {
      nodes = rawNodes.map((n) => ({ ...n }));
      edges = rawEdges.map((e) => ({ ...e })) as SimEdge[];
      edgeReveal = reducedMotion ? 1 : 0;
      selectedId = null;
      hoverId = null;
      focusId = null;
      highlightIds = null;
      pendingFit = true;
      restartSimulation();
    },
    selectNode(id) {
      selectedId = id;
      // Navigating to a node clears any persistent focus highlight.
      focusId = null;
      highlightIds = id ? computeNeighborSet(id) : null;
    },
    setHoverNode(id) {
      hoverId = id;
    },
    fitToView() {
      fitToNodes();
    },
    fitToNodes(ids) {
      fitToNodes(ids);
    },
    centerOnNode(id) {
      centerOnNode(id);
    },
    focusNode(id) {
      focusId = id;
      selectedId = id;
      highlightIds = computeNeighborSet(id);
      fitToNodes(highlightIds);
    },
    clearFocus() {
      focusId = null;
      highlightIds = selectedId ? computeNeighborSet(selectedId) : null;
    },
    zoomBy(factor) {
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      transform = transform.translate(cx, cy).scale(factor).translate(-cx, -cy);
      select(canvas).call(zoomBehavior.transform, transform);
    },
    resize() {
      resizeCanvas();
      restartSimulation();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      simulation?.stop();
      themeObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('keydown', handleKeydown);
      select(canvas).on('.zoom', null).on('.drag', null);
    },
    getTransform() {
      return transform;
    },
  };

  return api;
}
