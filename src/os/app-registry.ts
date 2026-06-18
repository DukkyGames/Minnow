import type { AppId, PresentationMode } from './types';

/** Launcher metadata for each MinnowOS app. */
export interface AppDefinition {
  id: AppId;
  name: string;
  icon: string;
  tag: string;
  description: string;
  presentationMode: PresentationMode;
}

/** Canonical app list — ported from MinnowOS prototype `data.jsx`. */
export const APPS: readonly AppDefinition[] = [
  {
    id: 'code',
    name: 'Code',
    icon: 'code',
    tag: 'Build & ship in a live workspace',
    description: 'Reef-side editor, dev server, files',
    presentationMode: 'fullscreen',
  },
  {
    id: 'chat',
    name: 'Chat',
    icon: 'chat',
    tag: 'Just talk to your model',
    description: 'General assistant — tools, files, and app routing',
    presentationMode: 'desktop',
  },
  {
    id: 'research',
    name: 'Research',
    icon: 'research',
    tag: 'Send a sub-agent to dig deep',
    description: 'Multi-step web + source synthesis',
    presentationMode: 'desktop',
  },
  {
    id: 'experts',
    name: "Experts",
    icon: 'flask',
    tag: 'Compose & test expert agents',
    description: 'Personas, tools, eval harness',
    presentationMode: 'desktop',
  },
  {
    id: 'bench',
    name: 'Benchmarking',
    icon: 'bench',
    tag: 'Measure models head-to-head',
    description: 'Throughput, latency, quality',
    presentationMode: 'window',
  },
  {
    id: 'compare',
    name: 'Compare',
    icon: 'compare',
    tag: 'Blind A/B model preference',
    description: 'Side-by-side votes, reveal, win rates',
    presentationMode: 'window',
  },
  {
    id: 'models',
    name: 'Models',
    icon: 'chip',
    tag: 'Download, run & tune models',
    description: 'Local runtimes, providers, recommendations',
    presentationMode: 'window',
  },
  {
    id: 'brain',
    name: 'Brain',
    icon: 'brain',
    tag: 'Wiki, memory & knowledge graph',
    description: 'Browse and maintain the CORTEX wiki',
    presentationMode: 'window',
  },
  {
    id: 'scheduler',
    name: 'Scheduler',
    icon: 'scheduler',
    tag: 'Recurring agent jobs & reminders',
    description: 'Interval and cron schedules while Minnow is running',
    presentationMode: 'sidePanel',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    icon: 'calendar',
    tag: 'Local events, ICS, and CalDAV',
    description: 'Month and week views with agent-assisted scheduling',
    presentationMode: 'window',
  },
  {
    id: 'email',
    name: 'Email',
    icon: 'email',
    tag: 'IMAP triage and draft replies',
    description: 'Read-only inbox sync, AI summaries, and explicit-send SMTP',
    presentationMode: 'fullscreen',
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: 'gear',
    tag: 'Appearance, prompts, agents',
    description: 'App, prompting, and integration settings',
    presentationMode: 'window',
  },
] as const;

const APP_IDS = new Set<AppId>(APPS.map((a) => a.id));

/** Type guard for route segments and registry lookups. */
export function isAppId(value: string): value is AppId {
  return APP_IDS.has(value as AppId);
}

/** Lookup launcher metadata by id. */
export function getAppById(id: AppId): AppDefinition | undefined {
  return APPS.find((a) => a.id === id);
}

/** Shell presentation mode for an app (defaults to fullscreen when unknown). */
export function getPresentationMode(id: AppId): PresentationMode {
  return getAppById(id)?.presentationMode ?? 'fullscreen';
}
