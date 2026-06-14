import type { AppId } from './types';

/** Launcher metadata for each MinnowOS app. */
export interface AppDefinition {
  id: AppId;
  name: string;
  icon: string;
  tag: string;
  description: string;
}

/** Canonical app list — ported from MinnowOS prototype `data.jsx`. */
export const APPS: readonly AppDefinition[] = [
  {
    id: 'code',
    name: 'Code',
    icon: 'code',
    tag: 'Build & ship in a live workspace',
    description: 'Reef-side editor, dev server, files',
  },
  {
    id: 'chat',
    name: 'Chat',
    icon: 'chat',
    tag: 'Just talk to your model',
    description: 'General assistant — tools, files, and app routing',
  },
  {
    id: 'research',
    name: 'Research',
    icon: 'research',
    tag: 'Send a sub-agent to dig deep',
    description: 'Multi-step web + source synthesis',
  },
  {
    id: 'experts',
    name: "Experts",
    icon: 'flask',
    tag: 'Compose & test expert agents',
    description: 'Personas, tools, eval harness',
  },
  {
    id: 'bench',
    name: 'Benchmarking',
    icon: 'bench',
    tag: 'Measure models head-to-head',
    description: 'Throughput, latency, quality',
  },
  {
    id: 'compare',
    name: 'Compare',
    icon: 'compare',
    tag: 'Blind A/B model preference',
    description: 'Side-by-side votes, reveal, win rates',
  },
  {
    id: 'models',
    name: 'Models',
    icon: 'chip',
    tag: 'Download, run & tune models',
    description: 'Local runtimes, providers, recommendations',
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: 'gear',
    tag: 'Appearance, prompts, agents',
    description: 'App, prompting, and integration settings',
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
