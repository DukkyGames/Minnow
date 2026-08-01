/**
 * Shared types for editor Intent mode (MIN-131).
 */

import type { EditorIntentModeConfig } from '../../config/editor-intent-mode';

export interface IntentResolveResult {
  text: string | null;
  error?: string;
}

/** Metadata for a line resolved from plain intent into code. */
export interface IntentRegion {
  from: number;
  to: number;
  intentText: string;
  ctxHash: string;
  stale: boolean;
}

/** Options passed when assembling Intent mode CodeMirror extensions. */
export interface IntentModeOptions {
  filePath: string;
  config: EditorIntentModeConfig;
  /** When false, no model requests are made (offline / no npm start). */
  canRequest: () => boolean;
  /** Whether Intent mode starts enabled for this document. */
  initialEnabled?: boolean;
  /** Fired when the user toggles Intent mode for this editor. */
  onEnabledChange?: (enabled: boolean) => void;
  /** Fired when stale-region count changes. */
  onStaleCount?: (count: number) => void;
  /** Optional status line under the editor (errors / resolving). */
  onStatus?: (message: string | null) => void;
  /**
   * Override intent resolve (tests). Defaults to {@link resolveIntentLine}.
   */
  resolveLineFn?: (
    input: ResolveIntentLineInput & { filePath: string },
  ) => Promise<IntentResolveResult>;
}

/** Input for a single-line intent resolve request. */
export interface ResolveIntentLineInput {
  filePath: string;
  intentText: string;
  above: string[];
  below: string[];
  signal: AbortSignal;
  onPartial?: (text: string) => void;
}
