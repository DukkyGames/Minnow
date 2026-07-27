import { getStageRect } from './stage-metrics';
import {
  createWindowControlButton,
  type WindowControlKind,
} from './window-control-buttons';
import { getWindowStageUsableSize } from './window-stage-bounds';
import {
  detectSnapPreview,
  getSnapRectForMode,
  shouldReleaseSnap,
  type SnapMode,
  type SnapPreview,
} from './window-snap';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowFrameOptions {
  windowId: string;
  title: string;
  bounds: WindowBounds;
  minWidth?: number;
  minHeight?: number;
  minimized?: boolean;
  maximized?: boolean;
  snapMode?: SnapMode | null;
  onFocus?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onBoundsChange?: (bounds: WindowBounds, meta: { snapMode: SnapMode | null; maximized: boolean }) => void;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** DOM factory for a draggable, resizable Minnow Shell window chrome. */
export class WindowFrame {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly titleEl: HTMLElement;

  private bounds: WindowBounds;
  private snapMode: SnapMode | null;
  private maximized: boolean;
  private minimized: boolean;
  private previewEl: HTMLElement | null = null;
  private dragState: {
    startX: number;
    startY: number;
    origin: WindowBounds;
    snapMode: SnapMode | null;
  } | null = null;
  private resizeState: {
    dir: ResizeDir;
    startX: number;
    startY: number;
    origin: WindowBounds;
  } | null = null;

  private readonly onFocus?: () => void;
  private readonly onClose?: () => void;
  private readonly onMinimize?: () => void;
  private readonly onMaximize?: () => void;
  private readonly onBoundsChange?: WindowFrameOptions['onBoundsChange'];
  private readonly minWidth: number;
  private readonly minHeight: number;

  constructor(options: WindowFrameOptions) {
    this.bounds = { ...options.bounds };
    this.minWidth = options.minWidth ?? MIN_WIDTH;
    this.minHeight = options.minHeight ?? MIN_HEIGHT;
    this.snapMode = options.snapMode ?? null;
    this.maximized = options.maximized ?? false;
    this.minimized = options.minimized ?? false;
    this.onFocus = options.onFocus;
    this.onClose = options.onClose;
    this.onMinimize = options.onMinimize;
    this.onMaximize = options.onMaximize;
    this.onBoundsChange = options.onBoundsChange;
    if (!this.maximized) {
      this.bounds = this.clampBounds(this.bounds);
    }

    const root = document.createElement('div');
    root.className = 'mn-os-window';
    root.dataset.windowId = options.windowId;
    root.tabIndex = -1;

    const titlebar = document.createElement('div');
    titlebar.className = 'mn-os-window-titlebar';
    titlebar.setAttribute('role', 'toolbar');
    titlebar.setAttribute('aria-label', `${options.title} window controls`);

    const dragRegion = document.createElement('div');
    dragRegion.className = 'mn-os-window-drag';

    const titleEl = document.createElement('span');
    titleEl.className = 'mn-os-window-title';
    titleEl.textContent = options.title;
    dragRegion.appendChild(titleEl);

    const controls = document.createElement('div');
    controls.className = 'mn-os-window-controls';

    const btnMin = this.makeControlButton('minimize', 'Minimize', () => this.onMinimize?.());
    const btnMax = this.makeControlButton('maximize', 'Maximize', () => this.toggleMaximize());
    const btnClose = this.makeControlButton('close', 'Close', () => this.onClose?.());
    controls.append(btnMin, btnMax, btnClose);

    titlebar.append(dragRegion, controls);

    const body = document.createElement('div');
    body.className = 'mn-os-window-body';

    const grips = document.createElement('div');
    grips.className = 'mn-os-window-resize-grips';
    grips.setAttribute('aria-hidden', 'true');
    for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      const grip = document.createElement('span');
      grip.className = `mn-os-window-grip mn-os-window-grip--${edge}`;
      grip.dataset.edge = edge;
      grips.appendChild(grip);
    }

    root.append(titlebar, body, grips);
    this.root = root;
    this.body = body;
    this.titleEl = titleEl;

    this.wireInteractions(titlebar, grips);
    this.applyBoundsToDom();
    this.applyMinimizedState();
  }

  getBounds(): WindowBounds {
    return { ...this.bounds };
  }

  getSnapMode(): SnapMode | null {
    return this.snapMode;
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  setMinimized(minimized: boolean): void {
    this.minimized = minimized;
    this.applyMinimizedState();
  }

  setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  setBounds(bounds: WindowBounds, meta?: { snapMode?: SnapMode | null; maximized?: boolean }): void {
    if (meta?.snapMode !== undefined) this.snapMode = meta.snapMode;
    if (meta?.maximized !== undefined) this.maximized = meta.maximized;
    this.bounds = this.maximized ? { ...bounds } : this.clampBounds(bounds);
    this.applyBoundsToDom();
  }

  /** Re-fit bounds when the stage viewport shrinks or grows (e.g. Electron window resize). */
  reclampToStage(): boolean {
    const stage = this.getStageRect();
    const prev = this.bounds;
    let next: WindowBounds;

    if (this.maximized || this.snapMode === 'maximize') {
      next = { x: 0, y: 0, width: stage.width, height: stage.height };
    } else if (this.snapMode === 'left' || this.snapMode === 'right') {
      next = { ...getSnapRectForMode(this.snapMode, stage) };
    } else {
      next = this.clampBounds(this.bounds);
    }

    if (
      prev.x === next.x &&
      prev.y === next.y &&
      prev.width === next.width &&
      prev.height === next.height
    ) {
      return false;
    }

    this.bounds = next;
    this.applyBoundsToDom();
    return true;
  }

  focus(): void {
    this.root.classList.add('is-focused');
    // Never steal DOM focus from an editable control inside the window body — doing so
    // leaves keyboard input dead until the user clicks outside the app (MIN-179).
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.body.contains(active) && isInteractiveFocusTarget(active)) {
      return;
    }
    this.root.focus({ preventScroll: true });
  }

  blur(): void {
    this.root.classList.remove('is-focused');
  }

  destroy(): void {
    this.clearSnapPreview();
    this.root.remove();
  }

  private makeControlButton(kind: WindowControlKind, label: string, onClick: () => void): HTMLButtonElement {
    return createWindowControlButton(kind, label, onClick);
  }

  private getStageRect(): DOMRect {
    return getStageRect();
  }

  private applyBoundsToDom(): void {
    const { x, y, width, height } = this.bounds;
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    this.root.style.width = `${width}px`;
    this.root.style.height = `${height}px`;
    this.root.classList.toggle('is-maximized', this.maximized);
    this.root.classList.toggle('is-snapped', Boolean(this.snapMode));
    this.root.dataset.snap = this.snapMode ?? '';
  }

  private applyMinimizedState(): void {
    this.root.classList.toggle('is-minimized', this.minimized);
  }

  private emitBoundsChange(): void {
    this.onBoundsChange?.(this.getBounds(), {
      snapMode: this.snapMode,
      maximized: this.maximized,
    });
  }

  private toggleMaximize(): void {
    if (this.onMaximize) {
      this.onMaximize();
      return;
    }
    if (this.maximized) {
      this.maximized = false;
      this.snapMode = null;
    } else {
      const stage = this.getStageRect();
      this.bounds = { x: 0, y: 0, width: stage.width, height: stage.height };
      this.maximized = true;
      this.snapMode = 'maximize';
    }
    this.applyBoundsToDom();
    this.emitBoundsChange();
  }

  private clearSnapPreview(): void {
    this.previewEl?.remove();
    this.previewEl = null;
  }

  private showSnapPreview(preview: SnapPreview): void {
    if (!this.previewEl) {
      this.previewEl = document.createElement('div');
      this.previewEl.className = 'mn-os-window-snap-preview';
      document.getElementById('osWindowsLayer')?.appendChild(this.previewEl);
    }
    const { x, y, width, height } = preview.rect;
    this.previewEl.style.left = `${x}px`;
    this.previewEl.style.top = `${y}px`;
    this.previewEl.style.width = `${width}px`;
    this.previewEl.style.height = `${height}px`;
    this.previewEl.dataset.mode = preview.mode;
  }

  private commitSnap(preview: SnapPreview): void {
    this.bounds = { ...preview.rect };
    this.snapMode = preview.mode;
    this.maximized = preview.mode === 'maximize';
    this.applyBoundsToDom();
    this.emitBoundsChange();
  }

  private clampBounds(bounds: WindowBounds): WindowBounds {
    const stage = this.getStageRect();
    const { width: usableW, height: usableH, insets } = getWindowStageUsableSize(stage);
    const width = Math.max(this.minWidth, Math.min(bounds.width, usableW));
    const height = Math.max(this.minHeight, Math.min(bounds.height, usableH));
    const maxX = Math.max(insets.left, usableW - width + insets.left);
    const maxY = Math.max(insets.top, usableH - height + insets.top);
    return {
      x: Math.min(Math.max(insets.left, bounds.x), maxX),
      y: Math.min(Math.max(insets.top, bounds.y), maxY),
      width,
      height,
    };
  }

  private wireInteractions(titlebar: HTMLElement, grips: HTMLElement): void {
    this.root.addEventListener('mousedown', () => this.onFocus?.());
    this.root.addEventListener('focusin', () => {
      if (this.root.classList.contains('is-focused')) return;
      this.onFocus?.();
    });

    titlebar.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      const target = ev.target as HTMLElement;
      if (target.closest('button')) return;
      ev.preventDefault();
      this.onFocus?.();

      const stageRect = this.getStageRect();
      if (this.snapMode && shouldReleaseSnap(
        this.snapMode,
        ev.clientX,
        ev.clientY,
        ev.clientX,
        ev.clientY,
        stageRect,
      )) {
        this.snapMode = null;
        this.maximized = false;
      }

      this.dragState = {
        startX: ev.clientX,
        startY: ev.clientY,
        origin: { ...this.bounds },
        snapMode: this.snapMode,
      };

      const onMove = (moveEv: MouseEvent) => {
        if (!this.dragState) return;
        const dx = moveEv.clientX - this.dragState.startX;
        const dy = moveEv.clientY - this.dragState.startY;
        if (this.dragState.snapMode) {
          const release = shouldReleaseSnap(
            this.dragState.snapMode,
            this.dragState.startX,
            this.dragState.startY,
            moveEv.clientX,
            moveEv.clientY,
            this.getStageRect(),
          );
          if (release) {
            this.snapMode = null;
            this.maximized = false;
            this.dragState.snapMode = null;
          } else {
            return;
          }
        }
        this.bounds = this.clampBounds({
          ...this.dragState.origin,
          x: this.dragState.origin.x + dx,
          y: this.dragState.origin.y + dy,
        });
        this.applyBoundsToDom();

        const preview = detectSnapPreview(moveEv.clientX, moveEv.clientY, this.getStageRect());
        if (preview) this.showSnapPreview(preview);
        else this.clearSnapPreview();
      };

      const onUp = (upEv: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const preview = detectSnapPreview(upEv.clientX, upEv.clientY, this.getStageRect());
        this.clearSnapPreview();
        if (preview) {
          this.commitSnap(preview);
        } else {
          this.emitBoundsChange();
        }
        this.dragState = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    grips.addEventListener('mousedown', (ev) => {
      const grip = (ev.target as HTMLElement).closest('.mn-os-window-grip') as HTMLElement | null;
      if (!grip || ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.onFocus?.();
      this.snapMode = null;
      this.maximized = false;

      const dir = grip.dataset.edge as ResizeDir;
      this.resizeState = {
        dir,
        startX: ev.clientX,
        startY: ev.clientY,
        origin: { ...this.bounds },
      };

      const onMove = (moveEv: MouseEvent) => {
        if (!this.resizeState) return;
        const dx = moveEv.clientX - this.resizeState.startX;
        const dy = moveEv.clientY - this.resizeState.startY;
        const o = this.resizeState.origin;
        let { x, y, width, height } = o;
        const dirParts = this.resizeState.dir;

        if (dirParts.includes('e')) width = o.width + dx;
        if (dirParts.includes('w')) {
          width = o.width - dx;
          x = o.x + dx;
        }
        if (dirParts.includes('s')) height = o.height + dy;
        if (dirParts.includes('n')) {
          height = o.height - dy;
          y = o.y + dy;
        }

        this.bounds = this.clampBounds({ x, y, width, height });
        this.applyBoundsToDom();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this.resizeState = null;
        this.emitBoundsChange();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

/** True when the element (or an ancestor) should keep DOM focus during window raise. */
function isInteractiveFocusTarget(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.closest('.cm-editor, [contenteditable="true"]')) return true;
  return false;
}

/** Create a window frame and append it to the windows layer. */
export function mountWindowFrame(
  layer: HTMLElement,
  options: WindowFrameOptions,
): WindowFrame {
  const frame = new WindowFrame(options);
  layer.appendChild(frame.root);
  return frame;
}
