import type { AppId, PresentationMode } from './types';

/** Whether users may turn the app off (optional) or it is always on (core). */
export type AppAvailability = 'core' | 'optional';

/**
 * Developer release gate. Hidden apps stay in the codebase but are omitted from
 * onboarding, Settings, dock, shortcuts, notifications, and launches.
 */
export type AppReleaseState = 'released' | 'hidden';

/** Launcher metadata for each Minnow app. */
export interface AppDefinition {
  id: AppId;
  name: string;
  icon: string;
  tag: string;
  description: string;
  presentationMode: PresentationMode;
  availability: AppAvailability;
  releaseState: AppReleaseState;
}

/** Canonical app list — ported from Minnow prototype `data.jsx`. */
export const APPS: readonly AppDefinition[] = [
  {
    id: 'code',
    name: 'Code',
    icon: 'code',
    tag: 'Build & ship in a live workspace',
    description: 'IDE-side editor, dev server, files',
    presentationMode: 'fullscreen',
    availability: 'core',
    releaseState: 'released',
  },
  {
    id: 'chat',
    name: 'Chat',
    icon: 'chat',
    tag: 'Just talk to your model',
    description: 'General assistant — tools, files, and app routing',
    presentationMode: 'desktop',
    availability: 'core',
    releaseState: 'released',
  },
  {
    id: 'research',
    name: 'Research',
    icon: 'research',
    tag: 'Send a sub-agent to dig deep',
    description: 'Multi-step web + source synthesis',
    presentationMode: 'desktop',
    availability: 'core',
    releaseState: 'released',
  },
  {
    id: 'experts',
    name: 'Experts',
    icon: 'flask',
    tag: 'Compose & test expert agents',
    description: 'Personas, tools, eval harness',
    presentationMode: 'desktop',
    availability: 'optional',
    releaseState: 'hidden',
  },
  {
    id: 'bench',
    name: 'Benchmarking',
    icon: 'bench',
    tag: 'Measure models head-to-head',
    description: 'Throughput, latency, quality',
    presentationMode: 'window',
    availability: 'optional',
    releaseState: 'hidden',
  },
  {
    id: 'compare',
    name: 'Compare',
    icon: 'compare',
    tag: 'Blind A/B model preference',
    description: 'Side-by-side votes, reveal, win rates',
    presentationMode: 'window',
    availability: 'optional',
    releaseState: 'hidden',
  },
  {
    id: 'models',
    name: 'Models',
    icon: 'chip',
    tag: 'Download, run & tune models',
    description: 'Local runtimes, providers, recommendations',
    presentationMode: 'window',
    availability: 'core',
    releaseState: 'released',
  },
  {
    id: 'brain',
    name: 'Brain',
    icon: 'brain',
    tag: 'Wiki, memory & knowledge graph',
    description: 'Browse and maintain your local Brain wiki',
    presentationMode: 'window',
    availability: 'core',
    releaseState: 'released',
  },
  {
    id: 'scheduler',
    name: 'Scheduler',
    icon: 'scheduler',
    tag: 'Recurring agent jobs & reminders',
    description: 'Interval and cron schedules while Minnow is running',
    presentationMode: 'sidePanel',
    availability: 'core',
    releaseState: 'released',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    icon: 'calendar',
    tag: 'Local events, ICS, and CalDAV',
    description: 'Month and week views with agent-assisted scheduling',
    presentationMode: 'window',
    availability: 'optional',
    releaseState: 'hidden',
  },
  {
    id: 'email',
    name: 'Email',
    icon: 'email',
    tag: 'IMAP triage and draft replies',
    description: 'Read-only inbox sync, AI summaries, and explicit-send SMTP',
    presentationMode: 'fullscreen',
    availability: 'optional',
    releaseState: 'hidden',
  },
  {
    id: 'issues',
    name: 'Issues',
    icon: 'issues',
    tag: 'Capture, triage, and track work',
    description: 'Linear-style issues — list, board, and quick capture',
    presentationMode: 'fullscreen',
    availability: 'core',
    releaseState: 'released',
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: 'gear',
    tag: 'Appearance, prompts, agents',
    description: 'App, prompting, and integration settings',
    presentationMode: 'window',
    availability: 'core',
    releaseState: 'released',
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

/** Core apps cannot be disabled by the user. */
export function isCoreApp(id: AppId): boolean {
  return getAppById(id)?.availability === 'core';
}

/** Optional apps may be toggled in onboarding / Settings → Apps. */
export function isOptionalApp(id: AppId): boolean {
  return getAppById(id)?.availability === 'optional';
}

/** Developer-released apps may appear in product surfaces. */
export function isDeveloperReleased(id: AppId): boolean {
  return getAppById(id)?.releaseState === 'released';
}

/** All apps marked released (ignores user preference). */
export function listReleasedApps(): AppDefinition[] {
  return APPS.filter((app) => app.releaseState === 'released');
}

/** Released core apps (always-on group for pickers). */
export function listCoreReleasedApps(): AppDefinition[] {
  return listReleasedApps().filter((app) => app.availability === 'core');
}

/** Released optional apps (selectable group for pickers). */
export function listOptionalReleasedApps(): AppDefinition[] {
  return listReleasedApps().filter((app) => app.availability === 'optional');
}

type AppModuleLoader = () => Promise<{ init: () => void | Promise<void> }>;

/** Dynamic import entry points for each Minnow app page bundle. */
export const APP_MODULE_LOADERS: Partial<Record<AppId, AppModuleLoader>> = {
  settings: () => import('../ui/settings-page').then((m) => ({ init: m.initSettingsPage })),
  bench: () => import('../ui/benchmark-page').then((m) => ({ init: m.initBenchmarkPage })),
  compare: () => import('../ui/compare-page').then((m) => ({ init: m.initComparePage })),
  models: () => import('../ui/models-page').then((m) => ({ init: m.initModelsPage })),
  brain: () => import('../ui/brain-page').then((m) => ({ init: m.initBrainPage })),
  scheduler: () => import('../ui/scheduler-page').then((m) => ({ init: m.initSchedulerPage })),
  calendar: () => import('../ui/calendar-page').then((m) => ({ init: m.initCalendarPage })),
  email: () => import('../ui/email-page').then((m) => ({ init: m.initEmailPage })),
  issues: () => import('../ui/issues-page').then((m) => ({ init: m.initIssuesPage })),
  research: () => import('../research/panel').then((m) => ({ init: m.initResearchPage })),
  chat: () => import('../ui/chat-app').then((m) => ({ init: m.initChatApp })),
  experts: () => import('../ui/experts/experts-hub').then((m) => ({ init: m.initExpertsHub })),
};
