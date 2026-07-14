/**
 * Settings field registry types — shared between client search and server agent tools.
 */

import type { SettingsCategoryId } from '../ui/settings-catalog';
import type { SettingsSectionId } from '../ui/settings-page-types';

/** Where a setting value is persisted. */
export type SettingsStorageKind =
  | 'meta'
  | 'resource'
  | 'provider'
  | 'mcp'
  | 'lsp'
  | 'webhook'
  | 'prompt'
  | 'browser'
  | 'section';

export type SettingsFieldType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'enum'
  | 'json';

export type SettingsSensitivity = 'normal' | 'secret' | 'dangerous';

/** Canonical registry entry for one settings field. */
export interface SettingsFieldDef {
  key: string;
  label: string;
  description?: string;
  keywords?: string[];
  category: SettingsCategoryId;
  area: SettingsSectionId;
  storage: SettingsStorageKind;
  /** JSON pointer / dot path into the backing document (when applicable). */
  path?: string;
  /** Named resource for `storage: resource` (e.g. search, tools, rules). */
  resource?: string;
  type: SettingsFieldType;
  allowedValues?: string[];
  sensitivity: SettingsSensitivity;
  writable: boolean;
  /** Settings sections to refresh after a write (client UI). */
  refreshAreas?: SettingsSectionId[];
}

/** Catalog metadata returned by search_settings (no values). */
export interface SettingsCatalogEntry {
  key: string;
  label: string;
  description?: string;
  type: SettingsFieldType;
  category: SettingsCategoryId;
  area: SettingsSectionId;
  allowedValues?: string[];
  sensitivity: SettingsSensitivity;
  writable: boolean;
}

/** One resolved setting value from get_settings. */
export interface SettingsReadValue {
  key: string;
  label: string;
  value: unknown;
  configured?: boolean;
  redacted?: boolean;
}

/** Patch item for update_settings. */
export interface SettingsChangePatch {
  key: string;
  value: unknown;
}

/** Server update result per key. */
export interface SettingsUpdateResult {
  applied: SettingsChangePatch[];
  skipped: { key: string; reason: string }[];
  errors: { key: string; error: string }[];
  clientPatches?: Record<string, unknown>;
}
