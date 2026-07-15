/**
 * Settings → General → App updates (MIN-384): status strip, version/check KV rows,
 * channel toggle, and manual check/restart actions wired to the Electron updater bridge.
 */

import {
  describeUpdaterStrip,
  formatLastChecked,
  formatNextCheck,
  getUpdaterApi,
  watchUpdaterStatus,
  type MinnowUpdaterStatus,
} from '../electron/updater-client';
import {
  createSettingsActionsRow,
  createSettingsKvList,
  createSettingsRadioRow,
} from './settings-controls';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const DEV_HINT = 'Updates apply to the installed Minnow app, not this dev session.';
const MACOS_HINT =
  'macOS auto-update requires code signing. Use manual download until certificates are configured.';
const BETA_HINT = 'Beta builds may be less stable. You can switch back to Stable anytime.';
const RESTART_WARNING = 'Active sessions will close and Minnow will reopen.';

/** Render the App updates group body. Reads/updates via window.minnow.updater. */
export function renderAppUpdatesSettings(mount: HTMLElement): void {
  const api = getUpdaterApi();
  if (!api) {
    // Browser tab or a shell built before the updater bridge existed.
    mount.appendChild(el('p', 'settings-field-hint', DEV_HINT));
    return;
  }

  const section = el('section', 'settings-updates');
  section.dataset.settingsSearchKey = 'general.updates';

  // Status strip — focal instrumentation, same vocabulary as the menubar pill.
  const strip = el('div', 'settings-updates-strip');
  strip.setAttribute('role', 'status');
  strip.setAttribute('aria-live', 'polite');
  const dot = el('span', 'settings-updates-strip__dot');
  dot.setAttribute('aria-hidden', 'true');
  const stripLabel = el('span', 'settings-updates-strip__label');
  const progress = el('div', 'settings-updates-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.hidden = true;
  const progressBar = el('div', 'settings-updates-progress__bar');
  progress.appendChild(progressBar);
  strip.append(dot, stripLabel, progress);
  section.appendChild(strip);

  const versionValue = el('code', 'settings-updates-version');
  const lastCheckedValue = el('span');
  const nextCheckValue = el('span');
  section.appendChild(
    createSettingsKvList(
      [
        { term: 'Installed version', value: versionValue },
        { term: 'Last checked', value: lastCheckedValue },
        { term: 'Next automatic check', value: nextCheckValue },
      ],
      { searchKey: 'general.updates' },
    ),
  );

  let suppressChannelEvents = false;
  const channel = createSettingsRadioRow('Update channel', {
    name: 'settings-update-channel',
    searchKey: 'general.updates.channel',
    options: [
      { value: 'stable', label: 'Stable' },
      { value: 'beta', label: 'Beta' },
    ],
    value: 'stable',
    onChange: (value) => {
      if (suppressChannelEvents) return;
      void api.setChannel(value === 'beta' ? 'beta' : 'stable');
    },
  });
  section.appendChild(channel.row);

  const betaHint = el('p', 'settings-field-hint settings-updates-beta-hint', BETA_HINT);
  betaHint.hidden = true;
  section.appendChild(betaHint);

  const channelHint = el(
    'p',
    'settings-field-hint',
    'Switching channel takes effect on the next check.',
  );
  section.appendChild(channelHint);

  const actions = createSettingsActionsRow(
    [
      {
        label: 'Check for updates',
        id: 'settingsUpdatesCheckBtn',
        onClick: () => {
          void api.checkNow();
        },
      },
      {
        label: 'Restart to update',
        id: 'settingsUpdatesRestartBtn',
        variant: 'primary',
        title: RESTART_WARNING,
        onClick: () => {
          void api.restart();
        },
      },
    ],
    { searchKey: 'general.updates' },
  );
  const checkBtn = actions.querySelector<HTMLButtonElement>('#settingsUpdatesCheckBtn');
  const restartBtn = actions.querySelector<HTMLButtonElement>('#settingsUpdatesRestartBtn');
  if (restartBtn) restartBtn.hidden = true;
  section.appendChild(actions);

  const restartWarning = el('p', 'settings-field-hint settings-updates-restart-warning', RESTART_WARNING);
  restartWarning.hidden = true;
  section.appendChild(restartWarning);

  const notes = el('details', 'settings-updates-notes') as HTMLDetailsElement;
  const notesSummary = el('summary', 'settings-updates-notes__summary');
  const notesBody = el('div', 'settings-updates-notes__body');
  notes.append(notesSummary, notesBody);
  notes.hidden = true;
  section.appendChild(notes);

  const unsupportedHint = el('p', 'settings-field-hint settings-updates-unsupported');
  unsupportedHint.hidden = true;
  section.appendChild(unsupportedHint);

  mount.appendChild(section);

  function applyStatus(status: MinnowUpdaterStatus): void {
    const strip2 = describeUpdaterStrip(status, navigator.onLine);
    strip.dataset.tone = strip2.tone;
    stripLabel.textContent = strip2.label;

    const downloading = status.state === 'downloading';
    progress.hidden = !downloading;
    if (downloading) {
      const percent = status.progressPercent ?? 0;
      progress.setAttribute('aria-valuenow', String(percent));
      progressBar.style.width = `${percent}%`;
    }

    versionValue.textContent = status.installedVersion;
    lastCheckedValue.textContent = formatLastChecked(status.lastCheckedAt);
    nextCheckValue.textContent = status.supported
      ? formatNextCheck(status.nextCheckAt)
      : '—';

    suppressChannelEvents = true;
    channel.setValue(status.channel);
    suppressChannelEvents = false;
    for (const input of channel.inputs) {
      input.disabled = !status.supported;
    }
    betaHint.hidden = status.channel !== 'beta';

    if (checkBtn) {
      checkBtn.disabled =
        !status.supported || status.state === 'checking' || status.state === 'downloading';
    }
    const ready = status.state === 'ready';
    if (restartBtn) restartBtn.hidden = !ready;
    restartWarning.hidden = !ready;

    const hasNotes = Boolean(status.pendingVersion && status.releaseNotes);
    notes.hidden = !hasNotes;
    if (hasNotes) {
      notesSummary.textContent = `What's new in ${status.pendingVersion}`;
      notesBody.textContent = status.releaseNotes ?? '';
    }

    if (!status.supported) {
      unsupportedHint.hidden = false;
      unsupportedHint.textContent =
        status.unsupportedReason === 'macos-signing' ? MACOS_HINT : DEV_HINT;
    } else {
      unsupportedHint.hidden = true;
    }
  }

  // Settings re-renders replace the mount wholesale; drop the subscription once
  // this render leaves the document.
  const stop = watchUpdaterStatus((status) => {
    if (!section.isConnected) {
      stop();
      return;
    }
    applyStatus(status);
  });
}
