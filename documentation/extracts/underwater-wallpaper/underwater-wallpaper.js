/**
 * Minnow Underwater Wallpaper — standalone mount helper.
 * Extracted from src/os/wallpaper.ts (underwater branch).
 */

/** @typedef {{ left: number; size: number; dur: number; delay: number; drift: number; op: number }} BubbleSpec */

/** Pre-generated bubble layout (stable across mounts). */
const BUBBLE_CACHE = randomBubbles(16);

/**
 * @param {number} count
 * @returns {BubbleSpec[]}
 */
function randomBubbles(count) {
  return Array.from({ length: count }, () => ({
    left: Math.random() * 100,
    size: 3 + Math.random() * 10,
    dur: 14 + Math.random() * 22,
    delay: -Math.random() * 30,
    drift: (Math.random() * 2 - 1) * 40,
    op: 0.05 + Math.random() * 0.12,
  }));
}

/**
 * Render the underwater wallpaper into `container` (replaces existing children).
 * @param {HTMLElement} container
 */
export function renderUnderwaterWallpaper(container) {
  container.replaceChildren();

  const wall = document.createElement('div');
  wall.className = 'mn-os-wall mn-os-wall-underwater';
  wall.setAttribute('aria-hidden', 'true');

  const glow = document.createElement('div');
  glow.className = 'mn-os-wall-glow';
  wall.appendChild(glow);

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

  container.appendChild(wall);
}
