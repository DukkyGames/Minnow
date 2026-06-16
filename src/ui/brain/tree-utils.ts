/**
 * Helpers for the Brain wiki page tree.
 */

import type { BrainPageMeta, BrainTreeNode } from '../../brain/types';

/** Flatten tree nodes into page metadata rows (for backlinks). */
export function flattenBrainTree(
  tree: BrainTreeNode | Record<string, BrainTreeNode> | null | undefined,
): BrainPageMeta[] {
  const pages: BrainPageMeta[] = [];
  if (!tree || typeof tree !== 'object') return pages;

  const walk = (node: BrainTreeNode | Record<string, BrainTreeNode>): void => {
    if ('type' in node && node.type === 'page') {
      pages.push(node);
      return;
    }
    if ('type' in node && node.type === 'folder' && node.children) {
      for (const child of Object.values(node.children)) {
        walk(child);
      }
      return;
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === 'object') walk(child as BrainTreeNode);
    }
  };

  walk(tree);
  return pages;
}

/** Compute inbound wikilink paths for a target page path. */
export function computeBrainBacklinks(
  pages: BrainPageMeta[],
  targetPath: string,
): string[] {
  const key = targetPath.replace(/\\/g, '/').replace(/\.md$/i, '');
  const inbound = new Set<string>();
  for (const page of pages) {
    for (const link of page.links ?? []) {
      const normalized = link.replace(/\\/g, '/').replace(/\.md$/i, '');
      if (normalized === key) inbound.add(page.path);
    }
  }
  return [...inbound].sort();
}
