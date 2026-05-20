/**
 * Native folder picker for workspace selection (local dev server only).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PICK_TIMEOUT_MS = 120_000;

/** @returns {Promise<string | null>} absolute path or null if cancelled */
async function pickFolderWindows() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = "Select workspace folder"',
    '$dialog.ShowNewFolderButton = $true',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  Write-Output $dialog.SelectedPath',
    '}',
  ].join('; ');

  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-STA', '-Command', script],
    { timeout: PICK_TIMEOUT_MS, windowsHide: true },
  );
  const picked = stdout.trim();
  return picked || null;
}

/** @returns {Promise<string | null>} */
async function pickFolderMac() {
  const { stdout } = await execFileAsync(
    'osascript',
    ['-e', 'POSIX path of (choose folder with prompt "Select workspace folder")'],
    { timeout: PICK_TIMEOUT_MS },
  );
  const picked = stdout.trim();
  return picked || null;
}

/** @returns {Promise<string | null>} */
async function pickFolderLinux() {
  try {
    const { stdout } = await execFileAsync(
      'zenity',
      ['--file-selection', '--directory', '--title=Select workspace folder'],
      { timeout: PICK_TIMEOUT_MS },
    );
    const picked = stdout.trim();
    return picked || null;
  } catch {
    try {
      const { stdout } = await execFileAsync(
        'kdialog',
        ['--getexistingdirectory', '.', 'Select workspace folder'],
        { timeout: PICK_TIMEOUT_MS },
      );
      const picked = stdout.trim();
      return picked || null;
    } catch {
      return null;
    }
  }
}

/**
 * Open a native directory picker when available.
 * @returns {Promise<{ path: string | null, cancelled: boolean, error?: string }>}
 */
export async function pickWorkspaceFolder() {
  try {
    let picked = null;
    if (process.platform === 'win32') {
      picked = await pickFolderWindows();
    } else if (process.platform === 'darwin') {
      picked = await pickFolderMac();
    } else {
      picked = await pickFolderLinux();
    }

    if (!picked) {
      return { path: null, cancelled: true };
    }
    return { path: picked, cancelled: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: null, cancelled: false, error: message };
  }
}
