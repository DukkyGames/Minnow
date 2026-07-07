/**
 * Design mode annotation overlay — numbered markers over a preview host.
 * Sibling SVG in the parent renderer (not injected into the guest DOM), so
 * markers survive guest reloads and stay in coordinates independent of the
 * guest document.
 */

import type { CapturedRegion } from './region-capture';

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
  resize(): void;
  destroy(): void;
}

export interface CreateAnnotationOverlayOptions {
  host: HTMLElement;
}

const OVERLAY_CLASS = 'mn-design-overlay';
const MARKER_LAYER_CLASS = 'mn-design-overlay-markers';
const DRAW_LAYER_CLASS = 'mn-design-overlay-draw';
const BADGE_SIZE = 20;

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

  const markerLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  markerLayer.setAttribute('class', MARKER_LAYER_CLASS);
  svg.appendChild(markerLayer);

  const drawLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  drawLayer.setAttribute('class', DRAW_LAYER_CLASS);
  svg.appendChild(drawLayer);

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
