import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function getProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

export async function importServerModule<T = Record<string, unknown>>(
  relativePath: string,
): Promise<T> {
  const fullPath = path.join(getProjectRoot(), 'server', relativePath);
  return import(pathToFileURL(fullPath).href) as Promise<T>;
}
