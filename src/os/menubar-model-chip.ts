/**
 * OS menubar default-model chip — icon control with hover expand + composer model menu.
 */

import {
  closeComposerModelMenu,
  mountMenubarModelChipTrigger,
} from '../ui/composer-model-trigger';

/** Wire the menubar default-model chip. Returns cleanup. */
export function initMenubarModelChip(anchor: HTMLElement): () => void {
  mountMenubarModelChipTrigger(anchor);
  return () => {
    closeComposerModelMenu();
  };
}
