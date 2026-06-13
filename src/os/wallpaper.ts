/** Ambient desktop wallpaper — flat, gradient, or underwater with caustics/bubbles. */

export type WallpaperMode = 'flat' | 'gradient' | 'underwater';

interface BubbleSpec {
  left: number;
  size: number;
  dur: number;
  delay: number;
  drift: number;
  op: number;
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

const BUBBLE_CACHE = randomBubbles(16);

/** Render wallpaper into `container` (replaces existing children). */
export function renderWallpaper(container: HTMLElement, mode: WallpaperMode): void {
  container.replaceChildren();

  const wall = document.createElement('div');
  wall.className = `mn-os-wall mn-os-wall-${mode}`;
  wall.setAttribute('aria-hidden', 'true');

  if (mode !== 'flat') {
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

    const vignette = document.createElement('div');
    vignette.className = 'mn-os-vignette';
    wall.appendChild(vignette);
  }

  container.appendChild(wall);
}
