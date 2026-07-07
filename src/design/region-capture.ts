/**
 * Design mode region capture — crop an element's bounding rect out of a
 * full-page preview screenshot using an offscreen canvas
 * (`boundingRect × devicePixelRatio`). No composer/attachment-store or
 * mode-state coupling — callers own what happens with the captured region.
 */

export interface DomRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedRegion {
  selector: string;
  boundingRect: DomRectLike;
  devicePixelRatio: number;
  /** True when a real crop was produced; false means the full-page fallback was used. */
  cropped: boolean;
  /** Cropped (or, when untainted-but-unsupported, full-page) image as a data URL. */
  dataUrl?: string;
  /** Uploaded screenshot id when the canvas was tainted and a server upload fallback ran. */
  serverId?: string;
  /** Server URL for the uploaded fallback screenshot. */
  url?: string;
  error?: string;
}

export interface RegionCaptureContext {
  selector: string;
  boundingRect: DomRectLike;
  devicePixelRatio: number;
}

type CropRect = { sx: number; sy: number; sw: number; sh: number };

/** Test hooks — override capture/crop/upload without Electron. */
export interface RegionCaptureTestHooks {
  capturePage?: () => Promise<string>;
  cropPngToDataUrl?: (
    fullPagePngBase64: string,
    crop: CropRect,
  ) => Promise<{ dataUrl: string } | { tainted: true }>;
  uploadScreenshot?: (dataBase64: string) => Promise<{ id: string; sizeBytes: number }>;
  scrollIntoView?: (selector: string) => Promise<void>;
  getPageDimensions?: (fullPagePngBase64: string) => Promise<{ pageW: number; pageH: number }>;
  compositeOverlay?: (
    cropDataUrl: string,
    svgMarkup: string,
    crop: CropRect,
    dpr: number,
  ) => Promise<{ dataUrl: string } | { tainted: true }>;
}

let testHooks: RegionCaptureTestHooks | null = null;

/** Replace capture dependencies in unit tests. */
export function setRegionCaptureTestHooks(hooks: RegionCaptureTestHooks | null): void {
  testHooks = hooks;
}

/** Test helper — reset hooks between tests. */
export function resetRegionCaptureForTests(): void {
  testHooks = null;
}

/** Pure crop math: CSS guest rect × DPR, rounded and clamped to page pixels. */
export function computeCropRect(
  rect: DomRectLike,
  dpr: number,
  pageW: number,
  pageH: number,
): CropRect {
  let sx = Math.round(rect.x * dpr);
  let sy = Math.round(rect.y * dpr);
  let sw = Math.round(rect.width * dpr);
  let sh = Math.round(rect.height * dpr);

  sx = Math.max(0, Math.min(sx, pageW));
  sy = Math.max(0, Math.min(sy, pageH));
  sw = Math.max(1, Math.min(sw, pageW - sx));
  sh = Math.max(1, Math.min(sh, pageH - sy));

  return { sx, sy, sw, sh };
}

/** Load PNG base64, crop sub-rect to a data URL (or report canvas taint). */
export async function cropPngToDataUrl(
  fullPagePngBase64: string,
  crop: CropRect,
): Promise<{ dataUrl: string } | { tainted: true }> {
  if (testHooks?.cropPngToDataUrl) {
    return testHooks.cropPngToDataUrl(fullPagePngBase64, crop);
  }

  const img = new Image();
  const src = fullPagePngBase64.startsWith('data:')
    ? fullPagePngBase64
    : `data:image/png;base64,${fullPagePngBase64}`;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('failed to decode screenshot PNG'));
    img.src = src;
  });

  const canvas = document.createElement('canvas');
  canvas.width = crop.sw;
  canvas.height = crop.sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    img.src = '';
    return { tainted: true };
  }

  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
  img.src = '';

  try {
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return { dataUrl };
  } catch {
    canvas.width = 0;
    canvas.height = 0;
    return { tainted: true };
  }
}

/**
 * Draw & Comment tool (MIN-367): rasterize the parent-owned SVG overlay (shapes/pins) onto an
 * already-cropped region screenshot, so the composited image "looks like" a marked-up
 * screenshot — not a separate overlay layer the model has to reconcile with the crop.
 */
export async function compositeOverlayOntoCrop(
  cropDataUrl: string,
  svgMarkup: string,
  crop: CropRect,
  dpr = 1,
): Promise<{ dataUrl: string } | { tainted: true }> {
  if (testHooks?.compositeOverlay) {
    return testHooks.compositeOverlay(cropDataUrl, svgMarkup, crop, dpr);
  }
  if (!svgMarkup) return { dataUrl: cropDataUrl };

  const baseImg = new Image();
  await new Promise<void>((resolve, reject) => {
    baseImg.onload = () => resolve();
    baseImg.onerror = () => reject(new Error('failed to decode crop image'));
    baseImg.src = cropDataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = crop.sw;
  canvas.height = crop.sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { tainted: true };
  ctx.drawImage(baseImg, 0, 0, crop.sw, crop.sh);
  baseImg.src = '';

  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  const overlayImg = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      overlayImg.onload = () => resolve();
      overlayImg.onerror = () => reject(new Error('failed to decode overlay svg'));
      overlayImg.src = svgDataUrl;
    });
    // The overlay SVG is sized in host CSS px (full preview host, not just the crop region);
    // scale by dpr and translate by the crop origin (device px) so it lines up with the crop.
    const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.drawImage(overlayImg, -crop.sx / scale, -crop.sy / scale);
    ctx.restore();
  } catch {
    // Overlay failed to decode (unsupported SVG-in-canvas in this runtime) — fall back to the
    // plain crop rather than losing the region capture entirely.
    overlayImg.src = '';
    canvas.width = 0;
    canvas.height = 0;
    return { dataUrl: cropDataUrl };
  }
  overlayImg.src = '';

  try {
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return { dataUrl };
  } catch {
    canvas.width = 0;
    canvas.height = 0;
    return { tainted: true };
  }
}

async function scrollElementIntoView(selector: string): Promise<void> {
  if (testHooks?.scrollIntoView) {
    await testHooks.scrollIntoView(selector);
    return;
  }
  const preview = window.minnow?.preview;
  if (!preview?.execJs || !selector) return;
  const script = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return { ok: true };
  })()`;
  await preview.execJs(script);
}

async function captureFullPageBase64(): Promise<string | null> {
  if (testHooks?.capturePage) {
    return testHooks.capturePage();
  }
  const preview = window.minnow?.preview;
  if (!preview?.capturePage) return null;
  const info = await preview.getInfo?.();
  if (info?.loading) {
    throw new Error('preview guest is still loading');
  }
  return preview.capturePage();
}

async function decodePageDimensions(
  fullPageBase64: string,
): Promise<{ pageW: number; pageH: number }> {
  if (testHooks?.getPageDimensions) {
    return testHooks.getPageDimensions(fullPageBase64);
  }

  const img = new Image();
  const src = fullPageBase64.startsWith('data:')
    ? fullPageBase64
    : `data:image/png;base64,${fullPageBase64}`;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('failed to decode screenshot PNG'));
    img.src = src;
  });

  const pageW = img.naturalWidth;
  const pageH = img.naturalHeight;
  img.src = '';
  return { pageW, pageH };
}

async function uploadScreenshotBase64(
  dataBase64: string,
): Promise<{ id: string; sizeBytes: number }> {
  if (testHooks?.uploadScreenshot) {
    return testHooks.uploadScreenshot(dataBase64);
  }
  const res = await fetch('/api/browser/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataBase64 }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `screenshot upload failed (HTTP ${res.status})`);
  }
  return (await res.json()) as { id: string; sizeBytes: number };
}

function buildCapturedBase(ctx: RegionCaptureContext, partial: Partial<CapturedRegion>): CapturedRegion {
  return {
    selector: ctx.selector,
    boundingRect: { ...ctx.boundingRect },
    devicePixelRatio: ctx.devicePixelRatio,
    cropped: false,
    ...partial,
  };
}

/**
 * Capture and crop the region for one element. Falls back to uploading the
 * full-page screenshot (with an explanatory `error`) when the crop canvas is
 * tainted (cross-origin preview content).
 */
export async function captureRegion(ctx: RegionCaptureContext): Promise<CapturedRegion> {
  let fullPageBase64: string | null = null;
  try {
    await scrollElementIntoView(ctx.selector);
    fullPageBase64 = await captureFullPageBase64();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildCapturedBase(ctx, { error: message });
  }

  if (!fullPageBase64) {
    return buildCapturedBase(ctx, { error: 'preview capture unavailable' });
  }

  const { pageW, pageH } = await decodePageDimensions(fullPageBase64);
  const crop = computeCropRect(ctx.boundingRect, ctx.devicePixelRatio, pageW, pageH);
  const cropped = await cropPngToDataUrl(fullPageBase64, crop);

  if ('dataUrl' in cropped) {
    return buildCapturedBase(ctx, { dataUrl: cropped.dataUrl, cropped: true });
  }

  try {
    const upload = await uploadScreenshotBase64(fullPageBase64);
    const url = `/api/browser/screenshot/${upload.id}`;
    const { x, y, width, height } = ctx.boundingRect;
    return buildCapturedBase(ctx, {
      serverId: upload.id,
      url,
      cropped: false,
      error: `full page — region @ ${Math.round(x)},${Math.round(y)} ${Math.round(width)}×${Math.round(height)}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildCapturedBase(ctx, { error: message });
  }
}

/**
 * Draw & Comment tool (MIN-367): {@link captureRegion} plus the parent-owned overlay SVG
 * rasterized on top, so the composited image reads like a marked-up screenshot. Falls back to
 * the plain crop (or the full-page/error result) when compositing can't run — never worse than
 * captureRegion alone.
 */
export async function captureRegionWithOverlay(
  ctx: RegionCaptureContext,
  svgMarkup: string,
): Promise<CapturedRegion> {
  const base = await captureRegion(ctx);
  if (!base.cropped || !base.dataUrl || !svgMarkup) return base;

  const dpr = ctx.devicePixelRatio || 1;
  const crop: CropRect = {
    sx: Math.round(ctx.boundingRect.x * dpr),
    sy: Math.round(ctx.boundingRect.y * dpr),
    sw: Math.max(1, Math.round(ctx.boundingRect.width * dpr)),
    sh: Math.max(1, Math.round(ctx.boundingRect.height * dpr)),
  };

  try {
    const composited = await compositeOverlayOntoCrop(base.dataUrl, svgMarkup, crop, dpr);
    if ('dataUrl' in composited) {
      return { ...base, dataUrl: composited.dataUrl };
    }
  } catch {
    /* fall back to the uncomposited crop below */
  }
  return base;
}
