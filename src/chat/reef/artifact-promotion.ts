/**
 * Promote large or allowlisted tool results to versioned reef artifacts.
 */

import type { ModeId } from '../modes/types.ts';
import { createReefArtifact } from './artifact-client.ts';
import {
  formatReefArtifactPointer,
  loadArtifactBundle,
  registerReefArtifactOnChat,
} from './artifact-context.ts';
import type { Chat } from '../../types.ts';

export interface ArtifactPromotionConfig {
  minChars: number;
  toolAllowlist: string[];
  modeAllowlist: ModeId[];
}

export const DEFAULT_ARTIFACT_PROMOTION: ArtifactPromotionConfig = {
  minChars: 4000,
  toolAllowlist: ['read_file', 'grep', 'list_directory', 'spawn_sub_agent'],
  modeAllowlist: ['reef', 'build', 'plan', 'orchestrate'],
};

export interface ArtifactPromotionContext {
  chatId: string;
  chat: Chat;
  toolName: string;
  args: unknown;
  content: string;
  toolCallId: string;
  modeId?: ModeId;
}

function slugFromTool(toolName: string, toolCallId: string): string {
  const tail = toolCallId.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase() || 'tool';
  return `${toolName}-${tail}`.slice(0, 64);
}

/**
 * When rules match, create v1 artifact and return pointer metadata for the tool message.
 */
export async function maybePromoteToolResultToArtifact(
  ctx: ArtifactPromotionContext,
  config: ArtifactPromotionConfig = DEFAULT_ARTIFACT_PROMOTION,
): Promise<{ artifactId: string; alias: string; footer: string; bundle?: string } | null> {
  const modeId = ctx.modeId ?? 'build';
  if (!config.modeAllowlist.includes(modeId)) {
    return null;
  }

  const len = ctx.content.length;
  const allowlisted = config.toolAllowlist.includes(ctx.toolName);
  if (len < config.minChars && !allowlisted) {
    return null;
  }

  const id = slugFromTool(ctx.toolName, ctx.toolCallId);
  const title = `${ctx.toolName} output`;
  const created = await createReefArtifact({
    id,
    title,
    body: ctx.content,
    author: 'tool',
    source: {
      type: 'tool',
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
    },
    chatIds: [ctx.chatId],
  });

  registerReefArtifactOnChat(ctx.chat, created.id);

  const refs = created.manifest.refs ?? [];
  let bundle: string | undefined;
  if (refs.length > 0) {
    bundle = await loadArtifactBundle(created.id);
  }

  const alias = `@minnow/reef/artifacts/${created.id}`;
  const footer = formatReefArtifactPointer(created.manifest);

  return {
    artifactId: created.id,
    alias,
    footer,
    bundle,
  };
}
