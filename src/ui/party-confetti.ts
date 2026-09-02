const PARTY_COLORS = [
  '#ff6b6b',
  '#ffd93d',
  '#6bcb77',
  '#4d96ff',
  '#ff6bd6',
  '#c77dff',
  '#ffa94d',
  '#ffffff',
];

const PARTICLE_COUNT = 110;
const GRAVITY = 0.22;
const DURATION_MS = 2800;

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rotation: number;
  spin: number;
  color: string;
  opacity: number;
}

/** Fire a one-shot confetti explosion from the top edge of the viewport. */
export function burstPartyConfetti(): void {
  if (typeof document === 'undefined') return;

  const canvas = document.createElement('canvas');
  canvas.className = 'party-confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  let width = window.innerWidth;
  let height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;

  const particles: ConfettiParticle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    particles.push({
      x: Math.random() * width,
      y: -12 - Math.random() * 40,
      vx: (Math.random() - 0.5) * 7,
      vy: 2 + Math.random() * 9,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 8,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.35,
      color: PARTY_COLORS[Math.floor(Math.random() * PARTY_COLORS.length)] ?? '#ffd93d',
      opacity: 0.85 + Math.random() * 0.15,
    });
  }

  const startedAt = performance.now();
  let raf = 0;

  const onResize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  };
  window.addEventListener('resize', onResize);

  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    canvas.remove();
  };

  const tick = (now: number) => {
    const elapsed = now - startedAt;
    if (elapsed >= DURATION_MS) {
      cleanup();
      return;
    }

    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.vy += GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.vx *= 0.99;

      const fadeStart = DURATION_MS * 0.72;
      const alpha =
        elapsed > fadeStart
          ? p.opacity * (1 - (elapsed - fadeStart) / (DURATION_MS - fadeStart))
          : p.opacity;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
}
