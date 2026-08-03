/**
 * Assemble workspace context document bodies for first-turn system prompt injection.
 */

import { readWorkspaceTextFile } from '../../attachments/workspace-text-read';
import { parseListDirectoryResult } from '../../lib/list-directory-parse';
import { wrapUntrusted } from '../../lib/untrusted.mjs';
import { executeTool } from '../../tools/client';
import { CONTEXT_DOCUMENT_PRESETS, type ContextDocumentPreset } from './catalog';
import type { ContextDocumentsConfig } from './config';

export interface RetrieveContextDocumentsBlockOptions {
  repoPath: string;
  documents: ContextDocumentsConfig;
}

const RULE_FILE_RE = /\.(md|mdc)$/i;

async function listRuleFilesInDirectory(
  dirPath: string,
  workspaceRoot: string,
): Promise<string[]> {
  const result = await executeTool(
    'list_directory',
    { path: dirPath },
    { workspaceRoot },
  );
  const content = result.content ?? '';
  const parsed = parseListDirectoryResult(content);
  if ('error' in parsed) return [];
  return parsed.files
    .filter((name) => RULE_FILE_RE.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `${dirPath.replace(/\/+$/, '')}/${name}`);
}

async function readPathText(
  path: string,
  workspaceRoot: string,
): Promise<string | null> {
  try {
    const text = await readWorkspaceTextFile(path, workspaceRoot);
    const trimmed = text.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

async function collectPathsForPreset(
  preset: ContextDocumentPreset,
  workspaceRoot: string,
): Promise<string[]> {
  if (preset.directory) {
    const dir = preset.paths[0];
    if (!dir) return [];
    return listRuleFilesInDirectory(dir, workspaceRoot);
  }
  const found: string[] = [];
  for (const candidate of preset.paths) {
    const text = await readPathText(candidate, workspaceRoot);
    if (text !== null) {
      found.push(candidate);
      break;
    }
  }
  return found;
}

async function resolveReadableSections(
  documents: ContextDocumentsConfig,
  workspaceRoot: string,
): Promise<Array<{ path: string; body: string }>> {
  const sections: Array<{ path: string; body: string }> = [];
  const seen = new Set<string>();

  const enabledPresetIds = new Set(documents.enabledPresets);
  for (const preset of CONTEXT_DOCUMENT_PRESETS) {
    if (!enabledPresetIds.has(preset.id)) continue;
    const paths = await collectPathsForPreset(preset, workspaceRoot);
    for (const path of paths) {
      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      const body = await readPathText(path, workspaceRoot);
      if (!body) continue;
      seen.add(key);
      sections.push({ path, body });
    }
  }

  for (const custom of documents.customPaths) {
    const path = custom.trim().replace(/\\/g, '/');
    if (!path) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    const body = await readPathText(path, workspaceRoot);
    if (!body) continue;
    seen.add(key);
    sections.push({ path, body });
  }

  return sections;
}

/** Build markdown sections and wrap as untrusted context for the model. */
export async function retrieveContextDocumentsBlock(
  options: RetrieveContextDocumentsBlockOptions,
): Promise<string> {
  const repoPath = options.repoPath.trim();
  if (!repoPath) return '';

  const sections = await resolveReadableSections(options.documents, repoPath);
  if (sections.length === 0) return '';

  const maxTotal = options.documents.maxTotalChars;
  const parts: string[] = [];
  let used = 0;
  let truncated = false;

  for (const { path, body } of sections) {
    const header = `### ${path}\n\n`;
    const chunk = header + body;
    const remaining = maxTotal - used;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (chunk.length <= remaining) {
      parts.push(chunk);
      used += chunk.length;
      continue;
    }
    parts.push(`${chunk.slice(0, remaining)}\n\n[… truncated — context document budget exceeded]`);
    truncated = true;
    break;
  }

  if (truncated && parts.length === 0) {
    return '';
  }

  const joined = parts.join('\n\n');
  if (!joined.trim()) return '';
  return wrapUntrusted(joined, { source: 'context-documents' });
}
