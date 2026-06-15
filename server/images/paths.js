/**
 * Gallery storage paths under ~/.minnow/gallery/.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Root gallery directory. */
export function galleryRoot() {
  return path.join(getMinnowHome(), 'gallery');
}

/** Generated/imported image files. */
export function galleryImagesDir() {
  return path.join(galleryRoot(), 'images');
}

/** JSON metadata index (albums + images). */
export function galleryIndexPath() {
  return path.join(galleryRoot(), 'index.json');
}
