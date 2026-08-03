import type { ProductWikiEntry } from './client';

export const PRODUCT_WIKI_NAV_SECTION_ORDER: readonly string[];
export const PRODUCT_WIKI_NAV_PATH_ORDER: readonly string[];
export function compareProductWikiEntries(a: ProductWikiEntry, b: ProductWikiEntry): number;
