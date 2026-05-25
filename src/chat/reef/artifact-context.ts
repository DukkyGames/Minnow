/**
 * Queue user reef artifact edits for the next chat send; resolve ref bundles for prompts.
 */

import type { Chat, ReefArtifactEditEvent } from '../../types.ts';
import { getReefArtifact, type ReefArtifactManifest } from './artifact-client.ts';

export type { ReefArtifactEditEvent };

const MAX_BUNDLE_DEPTH = 2;

/** Record a pending edit on the chat session (consumed on next user send). */
export function queueReefArtifactUserEdit(
  chat: Chat,
  event: Omit<ReefArtifactEditEvent, 'at'>,
): void {
  if (!chat.pendingReefArtifactEdits) {
    chat.pendingReefArtifactEdits = [];
  }
  chat.pendingReefArtifactEdits.push({
    ...event,
    at: new Date().toISOString(),
  });
  if (!chat.reefArtifactIds) {
    chat.reefArtifactIds = [];
  }
  if (!chat.reefArtifactIds.includes(event.artifactId)) {
    chat.reefArtifactIds.push(event.artifactId);
  }
}

/**
 * Build markdown appendix for pending user edits and clear the queue.
 * Returns empty string when nothing pending.
 */
export function consumeReefArtifactEditsForPrompt(chat: Chat): string {
  const pending = chat.pendingReefArtifactEdits;
  if (!pending?.length) return '';

  chat.pendingReefArtifactEdits = [];

  const lines = pending.map((e) => {
    const summary = e.summary?.trim() || `updated to v${e.version}`;
    return `- **${e.artifactId}** (${summary}) — \`@minnow/reef/artifacts/${e.artifactId}\` v${e.version}`;
  });

  return [
    '',
    '---',
    '**User edited reef artifacts** (since your last reply):',
    ...lines,
    '',
    'Acknowledge these edits in your next response; the user did not re-paste the full content.',
  ].join('\n');
}

/**
 * Resolve manifest refs into a prompt bundle (cycle-safe, depth-limited).
 */
export async function loadArtifactBundle(
  rootId: string,
  depth = MAX_BUNDLE_DEPTH,
): Promise<string> {
  const visited = new Set<string>();
  const sections: string[] = [];

  async function visit(id: string, level: number): Promise<void> {
    if (visited.has(id)) {
      sections.push(`<!-- ref cycle: ${id} -->`);
      return;
    }
    if (level > depth) return;

    visited.add(id);
    let row;
    try {
      row = await getReefArtifact(id);
    } catch {
      sections.push(`## Artifact: ${id}\n\n(not found)`);
      return;
    }

    const title = row.manifest.title || id;
    sections.push(
      `## Artifact: ${id} (v${row.version}) — ${title}\n\n${row.body.trim()}`,
    );

    if (level >= depth) return;

    const refs = row.manifest.refs ?? [];
    for (const refId of refs) {
      await visit(refId, level + 1);
    }
  }

  await visit(rootId, 0);
  return sections.join('\n\n');
}

/** Track artifact id on chat when created or promoted. */
export function registerReefArtifactOnChat(chat: Chat, artifactId: string): void {
  if (!chat.reefArtifactIds) {
    chat.reefArtifactIds = [];
  }
  if (!chat.reefArtifactIds.includes(artifactId)) {
    chat.reefArtifactIds.push(artifactId);
  }
}

/** Format manifest refs for tool-result footers. */
export function formatReefArtifactPointer(manifest: ReefArtifactManifest): string {
  return `\n\n[Reef artifact: @minnow/reef/artifacts/${manifest.id} v${manifest.currentVersion}]`;
}
