/** Edge proximity thresholds for window snap (px). */
export const SNAP_EDGE_PX = 12;
export const UNSNAP_DRAG_PX = 24;

export type SnapMode = 'left' | 'right' | 'maximize';

export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapPreview {
  mode: SnapMode;
  rect: SnapRect;
}

/** Detect snap target from pointer position within the stage viewport. */
export function detectSnapPreview(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
): SnapPreview | null {
  const relX = clientX - stageRect.left;
  const relY = clientY - stageRect.top;
  const w = stageRect.width;
  const h = stageRect.height;

  if (relY <= SNAP_EDGE_PX) {
    return {
      mode: 'maximize',
      rect: { x: 0, y: 0, width: w, height: h },
    };
  }
  if (relX <= SNAP_EDGE_PX) {
    return {
      mode: 'left',
      rect: { x: 0, y: 0, width: Math.round(w / 2), height: h },
    };
  }
  if (relX >= w - SNAP_EDGE_PX) {
    return {
      mode: 'right',
      rect: { x: Math.round(w / 2), y: 0, width: Math.round(w / 2), height: h },
    };
  }
  return null;
}

/** Whether a drag away from a snapped position should release the snap. */
export function shouldReleaseSnap(
  snapMode: SnapMode,
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
): boolean {
  const dx = clientX - startClientX;
  const dy = clientY - startClientY;
  const dist = Math.hypot(dx, dy);
  if (dist < UNSNAP_DRAG_PX) return false;

  const relX = clientX - stageRect.left;
  const relY = clientY - stageRect.top;
  const w = stageRect.width;

  if (snapMode === 'maximize') {
    return relY > SNAP_EDGE_PX * 2 || relX < SNAP_EDGE_PX || relX > w - SNAP_EDGE_PX;
  }
  if (snapMode === 'left') {
    return relX > w * 0.25;
  }
  if (snapMode === 'right') {
    return relX < w * 0.75;
  }
  return dist >= UNSNAP_DRAG_PX;
}
