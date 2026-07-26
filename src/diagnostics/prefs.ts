/**
 * Renderer diagnostics prefs persisted in localStorage (`minnow.diagnostics.*`).
 */

const STORAGE_PREFIX = 'minnow.diagnostics.';

export const DIAGNOSTICS_PREFS_KEYS = {
  fileErrorsToIssues: `${STORAGE_PREFIX}fileErrorsToIssues`,
} as const;

export type DiagnosticsPrefs = {
  /** Auto-create Issues app bug cards for uncaught renderer errors. */
  fileErrorsToIssues: boolean;
};

export const DEFAULT_DIAGNOSTICS_PREFS: DiagnosticsPrefs = {
  fileErrorsToIssues: false,
};

let cachedPrefs: DiagnosticsPrefs | null = null;

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
  } catch {
    /* private mode */
  }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode */
  }
}

/** Load diagnostics prefs (cached after first read). */
export function loadDiagnosticsPrefs(): DiagnosticsPrefs {
  if (cachedPrefs) return { ...cachedPrefs };

  const prefs: DiagnosticsPrefs = {
    fileErrorsToIssues: readBool(
      DIAGNOSTICS_PREFS_KEYS.fileErrorsToIssues,
      DEFAULT_DIAGNOSTICS_PREFS.fileErrorsToIssues,
    ),
  };
  cachedPrefs = prefs;
  return { ...prefs };
}

/** True when renderer errors should create Issues app bug cards. */
export function isFileErrorsToIssuesEnabled(): boolean {
  return loadDiagnosticsPrefs().fileErrorsToIssues;
}

/** Persist one diagnostics pref key. */
export function saveDiagnosticsPref<K extends keyof DiagnosticsPrefs>(
  key: K,
  value: DiagnosticsPrefs[K],
): void {
  const next = { ...loadDiagnosticsPrefs(), [key]: value };
  if (key === 'fileErrorsToIssues') {
    writeBool(DIAGNOSTICS_PREFS_KEYS.fileErrorsToIssues, Boolean(value));
  }
  cachedPrefs = next;
}

/** Clear cached prefs (tests). */
export function resetDiagnosticsPrefsForTests(): void {
  cachedPrefs = null;
}
