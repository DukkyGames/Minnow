/**
 * Schooling fish canvas wallpaper — boids attracted to the cursor.
 */

export interface MinnowFishWallpaperHandle {
  destroy: () => void;
}

interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  wigglePhase: number;
  wiggleRate: number;
}

const FISH_COUNT = 42;
const NEIGHBOR_RADIUS = 70;
const MOUSE_RADIUS = 140;
const MAX_SPEED = 1.0;
const MIN_SPEED = 0.18;
const GLYPH_URL = '/logos/minnow-glyph-white.svg';
const GLYPH_SIZE = 22;
const GLYPH_ALPHA = 0.5;
const WIGGLE_AMPLITUDE = 0.2;

function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function readAccentColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--mn-accent').trim();
  return v || '#9ec5a7';
}

/** Mount animated fish canvas; returns cleanup handle. */
export function mountMinnowFishWallpaper(container: HTMLElement): MinnowFishWallpaperHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'mn-os-wall-minnow-canvas';
  container.appendChild(canvas);

  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) {
    return { destroy: () => canvas.remove() };
  }
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  const reduced = prefersReducedMotion();
  let width = 0;
  let height = 0;
  let raf = 0;
  let mouseX = -9999;
  let mouseY = -9999;

  const fish: Fish[] = Array.from({ length: FISH_COUNT }, () => ({
    x: Math.random() * 800,
    y: Math.random() * 600,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    angle: 0,
    wigglePhase: Math.random() * Math.PI * 2,
    wiggleRate: 3.5 + Math.random() * 2.5,
  }));

  let glyphReady = false;
  const glyphImg = new Image();
  glyphImg.onload = () => {
    glyphReady = true;
  };
  glyphImg.src = GLYPH_URL;

  // Tint each glyph offscreen so source-in does not erase prior fish on the main canvas.
  const tintCanvas = document.createElement('canvas');
  tintCanvas.width = GLYPH_SIZE;
  tintCanvas.height = GLYPH_SIZE;
  const tintCtx = tintCanvas.getContext('2d');

  function resize(): void {
    const rect = container.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const f of fish) {
      f.x = Math.min(f.x, width);
      f.y = Math.min(f.y, height);
    }
  }

  function wrap(f: Fish): void {
    if (f.x < -20) f.x = width + 20;
    if (f.x > width + 20) f.x = -20;
    if (f.y < -20) f.y = height + 20;
    if (f.y > height + 20) f.y = -20;
  }

  function limitSpeed(f: Fish): void {
    const speed = Math.hypot(f.vx, f.vy);
    if (speed > MAX_SPEED) {
      f.vx = (f.vx / speed) * MAX_SPEED;
      f.vy = (f.vy / speed) * MAX_SPEED;
    } else if (speed < MIN_SPEED) {
      f.vx = (f.vx / (speed || 1)) * MIN_SPEED;
      f.vy = (f.vy / (speed || 1)) * MIN_SPEED;
    }
    f.angle = Math.atan2(f.vy, f.vx);
  }

  function stepBoids(): void {
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      let sepX = 0;
      let sepY = 0;
      let aliX = 0;
      let aliY = 0;
      let cohX = 0;
      let cohY = 0;
      let neighbors = 0;

      for (let j = 0; j < fish.length; j++) {
        if (i === j) continue;
        const o = fish[j];
        const dx = f.x - o.x;
        const dy = f.y - o.y;
        const dist = Math.hypot(dx, dy);
        if (dist > NEIGHBOR_RADIUS) continue;
        neighbors++;
        if (dist < 28 && dist > 0) {
          sepX += dx / dist;
          sepY += dy / dist;
        }
        aliX += o.vx;
        aliY += o.vy;
        cohX += o.x;
        cohY += o.y;
      }

      if (neighbors > 0) {
        aliX /= neighbors;
        aliY /= neighbors;
        cohX = cohX / neighbors - f.x;
        cohY = cohY / neighbors - f.y;
      }

      const mdx = mouseX - f.x;
      const mdy = mouseY - f.y;
      const mdist = Math.hypot(mdx, mdy);
      let attractX = 0;
      let attractY = 0;
      if (!reduced && mdist < MOUSE_RADIUS && mdist > 1) {
        const strength = 1 - mdist / MOUSE_RADIUS;
        attractX = (mdx / mdist) * strength * 1.8;
        attractY = (mdy / mdist) * strength * 1.8;
      }

      f.vx += sepX * 0.045 + aliX * 0.02 + cohX * 0.008 + attractX * 0.06;
      f.vy += sepY * 0.045 + aliY * 0.02 + cohY * 0.008 + attractY * 0.06;
      limitSpeed(f);
      if (!reduced) {
        f.x += f.vx;
        f.y += f.vy;
      }
      wrap(f);
    }
  }

  function drawFish(f: Fish, color: string, timeSec: number): void {
    if (!glyphReady || !tintCtx) return;

    const half = GLYPH_SIZE / 2;
    const speed = Math.hypot(f.vx, f.vy);
    const wiggle =
      reduced
        ? 0
        : Math.sin(timeSec * (f.wiggleRate + speed * 2.5) + f.wigglePhase) * WIGGLE_AMPLITUDE;
    const stretch = reduced ? 1 : 1 + Math.sin(timeSec * (f.wiggleRate + speed * 2.5) * 2 + f.wigglePhase) * 0.05;

    tintCtx.clearRect(0, 0, GLYPH_SIZE, GLYPH_SIZE);
    tintCtx.globalCompositeOperation = 'source-over';
    tintCtx.drawImage(glyphImg, 0, 0, GLYPH_SIZE, GLYPH_SIZE);
    tintCtx.globalCompositeOperation = 'source-in';
    tintCtx.fillStyle = color;
    tintCtx.fillRect(0, 0, GLYPH_SIZE, GLYPH_SIZE);

    ctx.save();
    ctx.translate(f.x, f.y);
    // SVG head faces left; velocity angle assumes head faces right.
    ctx.rotate(f.angle + Math.PI + wiggle);
    ctx.scale(stretch, 1);
    ctx.globalAlpha = GLYPH_ALPHA;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tintCanvas, -half, -half, GLYPH_SIZE, GLYPH_SIZE);
    ctx.restore();
  }

  function frame(now: number): void {
    const accent = readAccentColor();
    const timeSec = now * 0.001;
    ctx.clearRect(0, 0, width, height);
    if (!reduced) stepBoids();
    for (const f of fish) drawFish(f, accent, timeSec);
    raf = requestAnimationFrame(frame);
  }

  function onPointerMove(ev: PointerEvent): void {
    const rect = container.getBoundingClientRect();
    mouseX = ev.clientX - rect.left;
    mouseY = ev.clientY - rect.top;
  }

  function onPointerLeave(): void {
    mouseX = -9999;
    mouseY = -9999;
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();
  container.addEventListener('pointermove', onPointerMove, { passive: true });
  container.addEventListener('pointerleave', onPointerLeave);
  raf = requestAnimationFrame(frame);

  return {
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      canvas.remove();
    },
  };
}
