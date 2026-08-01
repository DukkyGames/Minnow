/** Ambient desktop wallpaper modes and render helpers. */

export type WallpaperMode =
  | 'flat'
  | 'gradient'
  | 'underwater'
  | 'minnow'
  | 'aurora'
  | 'starfield'
  | 'custom';

export type WallpaperImageFit = 'cover' | 'contain';

export interface WallpaperRenderOptions {
  mode: WallpaperMode;
  imageUrl?: string | null;
  imageFit?: WallpaperImageFit;
  /** Thumbnail picker — keep other preview instances alive. */
  preview?: boolean;
}

export const WALLPAPER_CATALOG: Array<{
  id: WallpaperMode;
  label: string;
  animated: boolean;
}> = [
  { id: 'underwater', label: 'Underwater', animated: true },
  { id: 'minnow', label: 'Minnow', animated: true },
  { id: 'aurora', label: 'Aurora', animated: true },
  { id: 'starfield', label: 'Starfield', animated: true },
  { id: 'gradient', label: 'Gradient', animated: false },
  { id: 'flat', label: 'Flat', animated: false },
  { id: 'custom', label: 'Custom image', animated: false },
];

interface BubbleSpec {
  left: number;
  size: number;
  dur: number;
  delay: number;
  drift: number;
  op: number;
}

interface StarSpec {
  left: number;
  top: number;
  size: number;
  dur: number;
  delay: number;
  /** Stable base opacity — never animated to zero (avoids pop in/out). */
  op: number;
  /** Near stars get a soft glow; far stars stay dim points. */
  near: boolean;
}

function randomBubbles(count: number): BubbleSpec[] {
  return Array.from({ length: count }, () => ({
    left: Math.random() * 100,
    size: 3 + Math.random() * 10,
    dur: 14 + Math.random() * 22,
    delay: -Math.random() * 30,
    drift: (Math.random() * 2 - 1) * 40,
    op: 0.05 + Math.random() * 0.12,
  }));
}

function randomStars(count: number): StarSpec[] {
  return Array.from({ length: count }, (_, i) => {
    // Sparse bright near-stars over a denser far field.
    const near = i % 5 === 0;
    return {
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: near ? 2.2 + Math.random() * 2.4 : 1.2 + Math.random() * 1.6,
      dur: near ? 48 + Math.random() * 36 : 72 + Math.random() * 48,
      delay: -Math.random() * 50,
      op: near ? 0.78 + Math.random() * 0.2 : 0.45 + Math.random() * 0.3,
      near,
    };
  });
}

const BUBBLE_CACHE = randomBubbles(16);
const STAR_CACHE = randomStars(90);

let minnowCleanup: (() => void) | null = null;
const previewMinnowCleanups = new WeakMap<HTMLElement, () => void>();

function clearMinnow(container?: HTMLElement): void {
  if (container) {
    const previewCleanup = previewMinnowCleanups.get(container);
    if (previewCleanup) {
      previewCleanup();
      previewMinnowCleanups.delete(container);
    }
    return;
  }
  if (minnowCleanup) {
    minnowCleanup();
    minnowCleanup = null;
  }
}

/** Render wallpaper into `container` (replaces existing children). */
export function renderWallpaper(
  container: HTMLElement,
  modeOrOptions: WallpaperMode | WallpaperRenderOptions,
): void {
  const options: WallpaperRenderOptions =
    typeof modeOrOptions === 'string' ? { mode: modeOrOptions } : modeOrOptions;
  const { mode, imageUrl, imageFit = 'cover', preview = false } = options;

  if (preview) {
    clearMinnow(container);
  } else {
    clearMinnow();
  }
  container.replaceChildren();

  const wall = document.createElement('div');
  wall.className = `mn-os-wall mn-os-wall-${mode}`;
  wall.setAttribute('aria-hidden', 'true');

  if (mode === 'custom' && imageUrl) {
    wall.style.backgroundImage = `url("${imageUrl.replace(/"/g, '%22')}")`;
    wall.style.backgroundSize = imageFit;
    wall.style.backgroundPosition = 'center';
    wall.style.backgroundRepeat = 'no-repeat';
    const overlay = document.createElement('div');
    overlay.className = 'mn-os-wall-custom-overlay';
    wall.appendChild(overlay);
  }

  if (mode !== 'flat' && mode !== 'custom') {
    const glow = document.createElement('div');
    glow.className = 'mn-os-wall-glow';
    wall.appendChild(glow);
  }

  if (mode === 'underwater') {
    const causticA = document.createElement('div');
    causticA.className = 'mn-os-caustic mn-os-caustic-a';
    const causticB = document.createElement('div');
    causticB.className = 'mn-os-caustic mn-os-caustic-b';
    wall.appendChild(causticA);
    wall.appendChild(causticB);

    const bubbles = document.createElement('div');
    bubbles.className = 'mn-os-bubbles';
    for (const b of BUBBLE_CACHE) {
      const span = document.createElement('span');
      span.style.left = `${b.left}%`;
      span.style.width = `${b.size}px`;
      span.style.height = `${b.size}px`;
      span.style.opacity = String(b.op);
      span.style.animationDuration = `${b.dur}s`;
      span.style.animationDelay = `${b.delay}s`;
      span.style.setProperty('--os-bubble-drift', `${b.drift}px`);
      bubbles.appendChild(span);
    }
    wall.appendChild(bubbles);
  }

  if (mode === 'starfield') {
    const stars = document.createElement('div');
    stars.className = 'mn-os-stars';
    for (const s of STAR_CACHE) {
      const span = document.createElement('span');
      if (s.near) span.classList.add('is-near');
      span.style.left = `${s.left}%`;
      span.style.top = `${s.top}%`;
      span.style.width = `${s.size}px`;
      span.style.height = `${s.size}px`;
      span.style.opacity = String(s.op);
      span.style.animationDuration = `${s.dur}s`;
      span.style.animationDelay = `${s.delay}s`;
      stars.appendChild(span);
    }
    wall.appendChild(stars);
  }

  if (mode === 'aurora') {
    // Three curtain bands so the wallpaper reads clearly in the picker and on desktop.
    const bandA = document.createElement('div');
    bandA.className = 'mn-os-aurora mn-os-aurora-a';
    const bandB = document.createElement('div');
    bandB.className = 'mn-os-aurora mn-os-aurora-b';
    const bandC = document.createElement('div');
    bandC.className = 'mn-os-aurora mn-os-aurora-c';
    wall.append(bandA, bandB, bandC);
  }

  if (mode === 'minnow') {
    const bg = document.createElement('div');
    bg.className = 'mn-os-wall-minnow-bg';
    wall.appendChild(bg);
    container.appendChild(wall);
    void import('./wallpaper/minnow-fish').then((m) => {
      const handle = m.mountMinnowFishWallpaper(container);
      if (preview) {
        previewMinnowCleanups.set(container, handle.destroy);
      } else {
        minnowCleanup = handle.destroy;
      }
    });
    const vignette = document.createElement('div');
    vignette.className = 'mn-os-vignette';
    container.appendChild(vignette);
    return;
  }

  if (mode !== 'flat') {
    const vignette = document.createElement('div');
    vignette.className = 'mn-os-vignette';
    wall.appendChild(vignette);
  }

  container.appendChild(wall);
}

/** Tear down animated wallpaper resources (tests / shell unmount). */
export function destroyWallpaperAnimations(): void {
  clearMinnow();
}
