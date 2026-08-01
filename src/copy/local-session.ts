/**
 * User-facing copy when Minnow's local backend is offline (MIN-529).
 * Avoid npm CLI and internal backend jargon in the UI.
 */

/** Generic retry hint when the local Minnow process is required. */
export const OPEN_MINNOW_RETRY = 'Open or restart Minnow and try again.';

/** Shorter variant for tight status lines. */
export const OPEN_MINNOW_SHORT = 'Open or restart Minnow.';

/** Settings banners: persistence needs the local app. */
export const SETTINGS_PERSIST_OFFLINE =
  'Open Minnow to save settings to disk. Until then, changes stay in this browser.';

/** Settings banners (HTML allowed). */
export const SETTINGS_PERSIST_OFFLINE_HTML =
  'Open Minnow to save settings to disk. Until then, changes stay in this browser.';

/** File, git, and other local tools unavailable in the composer or Settings → Tools. */
export const LOCAL_TOOLS_OFFLINE =
  'Some tools need Minnow running locally. Open or restart the app.';

/** Workspace picker / folder browse offline. */
export const WORKSPACE_OFFLINE =
  'Workspace features need Minnow running locally. Open or restart the app.';

export const SAVE_FAILED = 'Could not save. Open or restart Minnow and try again.';

export const LOAD_FAILED = 'Could not load. Open or restart Minnow and try again.';

export const NETWORK_FAILED = 'Network error. Open or restart Minnow and try again.';

export const PROVIDER_REGISTRY_OFFLINE =
  'Provider settings need Minnow running locally. Open or restart the app.';

/** Tool result / web_search when routing needs the local backend. */
export const WEB_SEARCH_NEEDS_MINNOW =
  'Error: This web search provider needs Minnow running locally. Open or restart the app.';

/** fetch_web_content hint appended when browser CORS blocks the request. */
export const FETCH_WEB_CONTENT_OFFLINE_SUFFIX =
  ' Open Minnow for in-app page fetch (avoids browser CORS limits).';

/** Permission gate when workspace is not selected. */
export const WORKSPACE_FOLDER_REQUIRED =
  'Not loaded — open Minnow and choose a workspace folder.';
