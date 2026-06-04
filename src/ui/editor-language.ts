/**
 * Resolve CodeMirror language support from filenames via @codemirror/language-data.
 */

import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';

/** Match a {@link LanguageDescription} for a workspace-relative file path. */
export function resolveLanguageDescription(filename: string): LanguageDescription | null {
  const basename = filename.split(/[/\\]/).pop() ?? filename;
  return (
    LanguageDescription.matchFilename(languages, basename) ??
    LanguageDescription.matchFilename(languages, filename) ??
    null
  );
}

/** Optional explicit language name (e.g. from modeline); falls back to filename. */
export function resolveLanguageDescriptionByName(languageName: string): LanguageDescription | null {
  const normalized = languageName.trim();
  if (!normalized) return null;
  return LanguageDescription.matchLanguageName(languages, normalized) ?? null;
}

/** Load syntax extensions for a file path; returns [] when unknown or load fails. */
export async function loadLanguageExtensionsForPath(path: string): Promise<Extension[]> {
  const desc = resolveLanguageDescription(path);
  if (!desc) return [];
  try {
    return [await desc.load()];
  } catch {
    return [];
  }
}
