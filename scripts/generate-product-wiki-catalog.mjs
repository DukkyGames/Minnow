import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductWikiCatalog } from './product-wiki-catalog-lib.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documentationRoot = path.join(repositoryRoot, 'documentation');
const outputPath = path.join(repositoryRoot, 'server', 'product-wiki', 'catalog.json');

/** Generate the committed catalog used by packaged and development runtimes. */
async function main() {
  const catalog = await buildProductWikiCatalog(documentationRoot);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Generated product wiki catalog with ${catalog.entries.length} pages.`);
}

await main();
