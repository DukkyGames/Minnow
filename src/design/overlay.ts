/**
 * Design mode annotation overlay — numbered markers over a preview host.
 * Sibling SVG in the parent renderer (not injected into the guest DOM), so
 * markers survive guest reloads and stay in coordinates independent of the
 * guest document.
 */

import type { CapturedRegion } from './region-capture';
import type { CommentPin, DesignShape } from './shape-model';

export interface OverlayMarker {
  id: string;
  index: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface AnnotationOverlay {
  render(markers: OverlayMarker[]): void;
  clear(): void;
  mapGuestRect(
    guestRect: { x: number; y: number; width: number; height: number },
    guestDevicePixelRatio: number,
  ): { x: number; y: number; width: number; height: number };
  pinCaptureToMarker(markerId: string, captured: CapturedRegion): void;
  removeCaptureFromMarker(markerId: string): void;
  enableFreeDraw(onRect: (rect: OverlayMarker['rect']) => void): void;
  disableFreeDraw(): void;
  /** Draw & Comment tool (MIN-367): pen/rect/arrow/label shapes in their own overlay layer. */
  renderShapes(shapes: DesignShape[]): void;
  /** Numbered comment pins; onPinClick fires with the pin id (host toggles the thread popover). */
  renderPins(pins: CommentPin[], onPinClick?: (pinId: string) => void): void;
  /** Serialized `<svg>` markup (markers + shapes + pins) for composite region capture. */
  getSvgMarkup(): string;
  resize(): void;
  destroy(): void;
}

export interface CreateAnnotationOverlayOptions {
  host: HTMLElement;
}

const OVERLAY_CLASS = 'mn-design-overlay';
const MARKER_LAYER_CLASS = 'mn-design-overlay-markers';
const DRAW_LAYER_CLASS = 'mn-design-overlay-draw';
const SHAPE_LAYER_CLASS = 'mn-design-overlay-shapes';
const PIN_LAYER_CLASS = 'mn-design-overlay-pins';
const BADGE_SIZE = 20;
const PIN_RADIUS = 11;

/** Create the SVG overlay mounted inside the given host element. */
export function createAnnotationOverlay(
  options: CreateAnnotationOverlayOptions,
): AnnotationOverlay {
  const { host } = options;
  host.style.position = host.style.position || 'relative';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', OVERLAY_CLASS);
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;overflow:visible;';
  host.appendChild(svg);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  arrowHead.setAttribute('id', 'mn-design-arrowhead');
  arrowHead.setAttribute('viewBox', '0 0 10 10');
  arrowHead.setAttribute('refX', '8');
  arrowHead.setAttribute('refY', '5');
  arrowHead.setAttribute('markerWidth', '8');
  arrowHead.setAttribute('markerHeight', '8');
  arrowHead.setAttribute('orient', 'auto-start-reverse');
  const arrowHeadPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowHeadPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowHeadPath.setAttribute('fill', 'var(--mn-accent)');
  arrowHead.appendChild(arrowHeadPath);
  defs.appendChild(arrowHead);
  svg.appendChild(defs);

  const markerLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  markerLayer.setAttribute('class', MARKER_LAYER_CLASS);
  svg.appendChild(markerLayer);

  const drawLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  drawLayer.setAttribute('class', DRAW_LAYER_CLASS);
  svg.appendChild(drawLayer);

  const shapeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  shapeLayer.setAttribute('class', SHAPE_LAYER_CLASS);
  svg.appendChild(shapeLayer);

  const pinLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  pinLayer.setAttribute('class', PIN_LAYER_CLASS);
  pinLayer.style.pointerEvents = 'auto';
  svg.appendChild(pinLayer);

  let freeDrawActive = false;
  let freeDrawCallback: ((rect: OverlayMarker['rect']) => void) | null = null;
  let drawStart: { x: number; y: number } | null = null;
  let draftRect: SVGRectElement | null = null;
  const pinnedCaptures = new Map<string, CapturedRegion>();

  const resizeObserver = new ResizeObserver(() => {
    syncViewBox();
  });
  resizeObserver.observe(host);

  function syncViewBox(): void {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
  }

  function hostContentScale(): number {
    const rect = host.getBoundingClientRect();
    const contentWidth = host.clientWidth || rect.width;
    if (!contentWidth) return 1;
    return rect.width / contentWidth;
  }

  function localPoint(ev: PointerEvent): { x: number; y: number } {
    const rect = host.getBoundingClientRect();
    const scale = hostContentScale() || 1;
    return {
      x: (ev.clientX - rect.left) / scale,
      y: (ev.clientY - rect.top) / scale,
    };
  }

  function onPointerDown(ev: PointerEvent): void {
    if (!freeDrawActive || !freeDrawCallback) return;
    drawStart = localPoint(ev);
    draftRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    draftRect.setAttribute('x', String(drawStart.x));
    draftRect.setAttribute('y', String(drawStart.y));
    draftRect.setAttribute('width', '0');
    draftRect.setAttribute('height', '0');
    draftRect.setAttribute('fill', 'var(--mn-accent-soft)');
    draftRect.setAttribute('stroke', 'var(--mn-accent)');
    draftRect.setAttribute('stroke-width', '2');
    draftRect.setAttribute('stroke-dasharray', '4 3');
    drawLayer.appendChild(draftRect);
    svg.setPointerCapture(ev.pointerId);
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!drawStart || !draftRect) return;
    const point = localPoint(ev);
    const x = Math.min(drawStart.x, point.x);
    const y = Math.min(drawStart.y, point.y);
    const width = Math.abs(point.x - drawStart.x);
    const height = Math.abs(point.y - drawStart.y);
    draftRect.setAttribute('x', String(x));
    draftRect.setAttribute('y', String(y));
    draftRect.setAttribute('width', String(width));
    draftRect.setAttribute('height', String(height));
  }

  function onPointerUp(ev: PointerEvent): void {
    if (!drawStart || !draftRect || !freeDrawCallback) return;
    const point = localPoint(ev);
    const x = Math.min(drawStart.x, point.x);
    const y = Math.min(drawStart.y, point.y);
    const width = Math.abs(point.x - drawStart.x);
    const height = Math.abs(point.y - drawStart.y);
    draftRect.remove();
    draftRect = null;
    drawStart = null;
    if (width >= 4 && height >= 4) {
      freeDrawCallback({ x, y, width, height });
    }
    try {
      svg.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);

  syncViewBox();

  return {
    render(markers: OverlayMarker[]): void {
      const activeIds = new Set(markers.map((marker) => marker.id));
      for (const id of pinnedCaptures.keys()) {
        if (!activeIds.has(id)) pinnedCaptures.delete(id);
      }
      markerLayer.innerHTML = '';
      for (const marker of markers) {
        const { rect, index } = marker;
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        outline.setAttribute('x', String(rect.x));
        outline.setAttribute('y', String(rect.y));
        outline.setAttribute('width', String(rect.width));
        outline.setAttribute('height', String(rect.height));
        outline.setAttribute('fill', 'none');
        outline.setAttribute('stroke', 'var(--mn-accent)');
        outline.setAttribute('stroke-width', '2');
        outline.setAttribute('rx', '2');
        markerLayer.appendChild(outline);

        const badgeX = rect.x + 4;
        const badgeY = Math.max(0, rect.y - BADGE_SIZE - 2);
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        badge.setAttribute('x', String(badgeX));
        badge.setAttribute('y', String(badgeY));
        badge.setAttribute('width', String(BADGE_SIZE));
        badge.setAttribute('height', String(BADGE_SIZE));
        badge.setAttribute('rx', '4');
        badge.setAttribute('fill', 'var(--mn-accent)');
        markerLayer.appendChild(badge);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(badgeX + BADGE_SIZE / 2));
        label.setAttribute('y', String(badgeY + BADGE_SIZE / 2 + 4));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', 'var(--mn-fg-on-accent)');
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'var(--font-ui)');
        label.setAttribute('font-weight', '600');
        const capture = pinnedCaptures.get(marker.id);
        if (capture?.cropped && capture.dataUrl) {
          const thumb = document.createElementNS('http://www.w3.org/2000/svg', 'image');
          thumb.setAttribute('href', capture.dataUrl);
          thumb.setAttribute('x', String(rect.x));
          thumb.setAttribute('y', String(rect.y));
          thumb.setAttribute('width', String(rect.width));
          thumb.setAttribute('height', String(rect.height));
          thumb.setAttribute('opacity', '0.35');
          thumb.setAttribute('preserveAspectRatio', 'none');
          markerLayer.insertBefore(thumb, outline);
        } else if (capture && !capture.cropped) {
          const hint = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          hint.textContent =
            capture.error ??
            `full page — region @ ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}×${Math.round(rect.height)}`;
          outline.appendChild(hint);
          label.textContent = `${index}*`;
        } else {
          label.textContent = String(index);
        }
        markerLayer.appendChild(label);
      }
    },

    clear(): void {
      markerLayer.innerHTML = '';
      drawLayer.innerHTML = '';
      pinnedCaptures.clear();
    },

    pinCaptureToMarker(markerId, captured): void {
      pinnedCaptures.set(markerId, { ...captured, boundingRect: { ...captured.boundingRect } });
    },

    removeCaptureFromMarker(markerId): void {
      pinnedCaptures.delete(markerId);
    },

    mapGuestRect(guestRect, _guestDevicePixelRatio): OverlayMarker['rect'] {
      // Overlay placement is CSS-px identity; DPR only matters for raster capture, not overlay scale.
      void _guestDevicePixelRatio;
      const scale = hostContentScale();
      if (!Number.isFinite(scale) || scale === 0 || scale === 1) {
        return { ...guestRect };
      }
      return {
        x: guestRect.x / scale,
        y: guestRect.y / scale,
        width: guestRect.width / scale,
        height: guestRect.height / scale,
      };
    },

    enableFreeDraw(onRect): void {
      freeDrawActive = true;
      freeDrawCallback = onRect;
      svg.style.pointerEvents = 'auto';
      svg.style.cursor = 'crosshair';
    },

    disableFreeDraw(): void {
      freeDrawActive = false;
      freeDrawCallback = null;
      drawStart = null;
      draftRect?.remove();
      draftRect = null;
      drawLayer.innerHTML = '';
      svg.style.pointerEvents = 'none';
      svg.style.cursor = '';
    },

    renderShapes(shapes: DesignShape[]): void {
      shapeLayer.innerHTML = '';
      for (const shape of shapes) {
        if (shape.kind === 'pen' && shape.points?.length) {
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', shape.points.map((p) => `${p.x},${p.y}`).join(' '));
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke', 'var(--mn-accent)');
          polyline.setAttribute('stroke-width', '2');
          polyline.setAttribute('stroke-linecap', 'round');
          polyline.setAttribute('stroke-linejoin', 'round');
          shapeLayer.appendChild(polyline);
        } else if (shape.kind === 'rect' && shape.rect) {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', String(shape.rect.x));
          rect.setAttribute('y', String(shape.rect.y));
          rect.setAttribute('width', String(shape.rect.width));
          rect.setAttribute('height', String(shape.rect.height));
          rect.setAttribute('rx', '2');
          rect.setAttribute('fill', 'var(--mn-accent-soft)');
          rect.setAttribute('fill-opacity', '0.25');
          rect.setAttribute('stroke', 'var(--mn-accent)');
          rect.setAttribute('stroke-width', '2');
          shapeLayer.appendChild(rect);
        } else if (shape.kind === 'arrow' && shape.points?.length === 2) {
          const [from, to] = shape.points;
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(from!.x));
          line.setAttribute('y1', String(from!.y));
          line.setAttribute('x2', String(to!.x));
          line.setAttribute('y2', String(to!.y));
          line.setAttribute('stroke', 'var(--mn-accent)');
          line.setAttribute('stroke-width', '2.5');
          line.setAttribute('marker-end', 'url(#mn-design-arrowhead)');
          shapeLayer.appendChild(line);
        } else if (shape.kind === 'label') {
          const rect = shape.rect ?? {
            x: (shape.points?.[0]?.x ?? 0) - 4,
            y: (shape.points?.[0]?.y ?? 0) - 10,
            width: Math.max(24, (shape.label?.length ?? 0) * 7),
            height: 20,
          };
          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bg.setAttribute('x', String(rect.x));
          bg.setAttribute('y', String(rect.y));
          bg.setAttribute('width', String(rect.width));
          bg.setAttribute('height', String(rect.height));
          bg.setAttribute('rx', '3');
          bg.setAttribute('fill', 'var(--mn-accent)');
          shapeLayer.appendChild(bg);
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(rect.x + 6));
          text.setAttribute('y', String(rect.y + rect.height / 2 + 4));
          text.setAttribute('fill', 'var(--mn-fg-on-accent)');
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'var(--font-ui)');
          text.textContent = shape.label ?? '';
          shapeLayer.appendChild(text);
        }
      }
    },

    renderPins(pins: CommentPin[], onPinClick): void {
      pinLayer.innerHTML = '';
      for (const pin of pins) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(pin.x));
        circle.setAttribute('cy', String(pin.y));
        circle.setAttribute('r', String(PIN_RADIUS));
        circle.setAttribute('fill', 'var(--mn-accent)');
        circle.setAttribute('stroke', 'var(--mn-fg-on-accent)');
        circle.setAttribute('stroke-width', '1.5');
        circle.style.cursor = 'pointer';
        circle.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onPinClick?.(pin.id);
        });
        pinLayer.appendChild(circle);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(pin.x));
        label.setAttribute('y', String(pin.y + 4));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', 'var(--mn-fg-on-accent)');
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'var(--font-ui)');
        label.setAttribute('font-weight', '600');
        label.style.pointerEvents = 'none';
        label.textContent = String(pin.index);
        pinLayer.appendChild(label);
      }
    },

    getSvgMarkup(): string {
      try {
        const XmlSerializerCtor = (host.ownerDocument?.defaultView as (Window & { XMLSerializer?: typeof XMLSerializer }) | null)
          ?.XMLSerializer;
        if (XmlSerializerCtor) {
          return new XmlSerializerCtor().serializeToString(svg);
        }
      } catch {
        /* fall through to outerHTML */
      }
      return (svg as unknown as { outerHTML?: string }).outerHTML ?? '';
    },

    resize(): void {
      syncViewBox();
    },

    destroy(): void {
      resizeObserver.disconnect();
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.remove();
    },
  };
}
