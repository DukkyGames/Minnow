/** Inline SVG icons for MinnowOS shell (ported from prototype icons.jsx). */

/** Public path for the Compare app raster glyph. */
export const COMPARE_ICON_SRC = '/icons/compare.png';

export type OsIconName =
  | 'code'
  | 'chat'
  | 'research'
  | 'flask'
  | 'bench'
  | 'compare'
  | 'scheduler'
  | 'calendar'
  | 'chip'
  | 'gear'
  | 'arrowUp'
  | 'arrowDown'
  | 'grid'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'bell'
  | 'fish';

/** Launcher icons rendered from a PNG mask instead of inline SVG paths. */
export type RasterIconName = 'compare';

/** Inline SVG icon ids (excludes raster-backed launcher icons). */
export type SvgIconName = Exclude<OsIconName, RasterIconName>;

const PATHS: Record<SvgIconName, string> = {
  code: '<path d="M8 7l-5 5 5 5"/><path d="M16 7l5 5-5 5"/><path d="M13.5 4l-3 16"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20.5l1.3-5.4A8 8 0 1 1 21 12Z"/>',
  research: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  flask:
    '<path d="M9 3h6"/><path d="M10 3v6l-5 8.5A2 2 0 0 0 6.7 21h10.6a2 2 0 0 0 1.7-3.5L14 9V3"/><path d="M7.5 14h9"/>',
  bench:
    '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  scheduler:
    '<path d="M16 14v2.2l1.6 1"/><path d="M16 2v4"/><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M3 10h5"/><path d="M8 2v4"/><circle cx="16" cy="16" r="6"/>',
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/>',
  chip:
    '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  arrowUp: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  fish: '<path d="M16.5 12c-2 3-5.5 4.5-9 4.5 1-1.5 1-3 1-4.5s0-3-1-4.5c3.5 0 7 1.5 9 4.5Z"/><path d="M16.5 12 21 8.5v7L16.5 12Z"/><circle cx="9.5" cy="11" r=".6" fill="currentColor" stroke="none"/>',
};

/** App launcher icons backed by a PNG mask instead of inline SVG paths. */
const RASTER_ICON_SRC: Record<RasterIconName, string> = {
  compare: COMPARE_ICON_SRC,
};

export interface OsIconOptions {
  size?: number;
  stroke?: number;
  className?: string;
}

/**
 * Create a launcher icon — raster mask when available, otherwise inline SVG.
 * Raster icons inherit `currentColor` from their parent (accent on dock tiles).
 */
export function createAppIcon(name: OsIconName, options: OsIconOptions = {}): HTMLSpanElement | SVGSVGElement {
  const rasterSrc = RASTER_ICON_SRC[name as RasterIconName];
  if (rasterSrc) {
    const { size = 20, className } = options;
    const span = document.createElement('span');
    span.className = 'mn-os-icon-raster';
    span.setAttribute('aria-hidden', 'true');
    span.style.width = `${size}px`;
    span.style.height = `${size}px`;
    span.style.setProperty('--icon-mask', `url('${rasterSrc}')`);
    if (className) span.classList.add(className);
    return span;
  }
  return createOsIcon(name as SvgIconName, options);
}

/** Create an SVG icon element. */
export function createOsIcon(name: SvgIconName, options: OsIconOptions = {}): SVGSVGElement {
  const { size = 20, stroke = 1.6, className } = options;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  svg.innerHTML = PATHS[name] ?? '';
  return svg;
}
