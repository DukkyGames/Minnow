/**
 * Workspace / file-path image detection (shared by file viewer and composer).
 * Extension set matches file-picker images in reader.ts.
 */

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

/** Lowercase extension without the dot, or empty string. */
function fileExtension(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** True when the path ends with a known raster/vector image extension. */
export function isImageFilePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(path));
}

/** MIME type for preview / attachment metadata from a file path. */
export function mimeTypeForImagePath(path: string): string {
  const ext = fileExtension(path);
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}
