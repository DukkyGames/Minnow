/**
 * Import OS-dropped files into the workspace via the tool server (binary-safe).
 */

import { MAX_ATTACHMENT_BYTES } from '../attachments/reader';
import { getLocalServerAvailable } from '../tools/client';
import { joinTreePath, normalizeTreePath } from './file-tree-path';
import { parseToolResult } from './file-tree-parse-result';
import { refreshFileTreeViaBridge } from './file-tree-refresh-bridge';
import { setStatus } from './status';

/** Server tool name (UI-only; not exposed to the LLM tool list). */
const IMPORT_TOOL = 'import_workspace_file';

/** Read a browser File as a base64 string for POST /api/tools. */
async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** POST one file to import_workspace_file on the local tool server. */
async function importOneFile(file: File, destDir: string): Promise<{ ok: boolean; message: string }> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      message: `${file.name}: exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`,
    };
  }

  const destPath = normalizeTreePath(joinTreePath(destDir, file.name));
  let content: string;
  try {
    content = await readFileAsBase64(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `${file.name}: ${message}` };
  }

  let response: Response;
  try {
    response = await fetch('/api/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: IMPORT_TOOL,
        args: { path: destPath, content },
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `${file.name}: ${message}` };
  }

  let payload: { result?: string; error?: string };
  try {
    payload = (await response.json()) as { result?: string; error?: string };
  } catch {
    return { ok: false, message: `${file.name}: invalid server response` };
  }

  if (!response.ok) {
    return { ok: false, message: payload.error ?? `${file.name}: HTTP ${response.status}` };
  }

  return parseToolResult(String(payload.result ?? ''));
}

/**
 * Copy dropped OS files into a workspace folder (relative path, e.g. `.` or `src/lib`).
 * Refreshes the file tree when at least one file succeeds.
 */
export async function importExternalFilesToWorkspace(
  files: File[],
  destDir: string,
): Promise<{ imported: number; errors: string[] }> {
  if (!files.length) {
    return { imported: 0, errors: [] };
  }

  if (!getLocalServerAvailable()) {
    setStatus('err', 'Start with npm start to import files into the workspace.');
    return { imported: 0, errors: ['Tool server unavailable'] };
  }

  const dir = normalizeTreePath(destDir === '' ? '.' : destDir);
  let imported = 0;
  const errors: string[] = [];

  setStatus('spin', `Importing ${files.length} file${files.length === 1 ? '' : 's'}…`);

  for (const file of files) {
    const result = await importOneFile(file, dir);
    if (result.ok) {
      imported += 1;
    } else {
      errors.push(result.message);
    }
  }

  if (imported > 0) {
    await refreshFileTreeViaBridge();
    setStatus(
      'ok',
      `Imported ${imported} file${imported === 1 ? '' : 's'} to ${dir === '.' ? 'workspace root' : dir}`,
    );
  } else if (errors.length) {
    setStatus('err', errors[0] ?? 'Import failed');
  } else {
    setStatus('err', 'No files imported');
  }

  return { imported, errors };
}
