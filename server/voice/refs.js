/**
 * Reference audio uploads and saved voice-clone prompts.
 */

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getVoiceClonePromptsDir, getVoiceRefsDir } from './paths.js';

const REF_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.webm', '.m4a']);

/**
 * Save an uploaded reference audio file under ~/.minnow/voice/refs/.
 * @param {{ buffer: Buffer, filename: string, mime: string }} file
 */
export async function saveRefAudio(file) {
  const ext = path.extname(file.filename || '').toLowerCase();
  const safeExt = REF_EXTENSIONS.has(ext) ? ext : '.wav';
  const id = crypto.randomUUID();
  const refsDir = getVoiceRefsDir();
  await fsp.mkdir(refsDir, { recursive: true });
  const destPath = path.join(refsDir, `${id}${safeExt}`);
  await fsp.writeFile(destPath, file.buffer);
  return {
    id,
    path: destPath,
    filename: `${id}${safeExt}`,
    mime: file.mime,
    sizeBytes: file.buffer.length,
  };
}

/**
 * List saved voice-clone prompt metadata files.
 */
export async function listClonePrompts() {
  const dir = getVoiceClonePromptsDir();
  await fsp.mkdir(dir, { recursive: true });
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const prompts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, entry.name), 'utf8');
      const parsed = JSON.parse(raw);
      prompts.push({
        id: entry.name.replace(/\.json$/, ''),
        label: typeof parsed.label === 'string' ? parsed.label : entry.name,
        refAudioPath: typeof parsed.refAudioPath === 'string' ? parsed.refAudioPath : '',
        refText: typeof parsed.refText === 'string' ? parsed.refText : '',
        language: typeof parsed.language === 'string' ? parsed.language : 'Auto',
        xVectorOnlyMode: parsed.xVectorOnlyMode === true,
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
      });
    } catch {
      /* skip corrupt prompt files */
    }
  }
  prompts.sort((a, b) => b.createdAt - a.createdAt);
  return prompts;
}
