/**
 * Settings → General: Education Mode (tutor overlay + teaching level).
 */

import {
  EDUCATION_LEVELS,
  loadEducationMeta,
  saveEducationMeta,
  type EducationLevel,
} from '../config/education-meta';
import { detectConfigServer, isConfigServerMode } from '../config/storage-mode';
import { appendSettingsOfflineHint, createSettingsSelectRow } from './settings-controls';
import { createSettingsToggleRow } from './settings-switch';
import { setStatus } from './status';

const LEVEL_LABELS: Record<EducationLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

const LEVEL_HINTS: Record<EducationLevel, string> = {
  beginner:
    'Defines jargon on first use, one concept at a time, small steps between hints.',
  intermediate:
    'Assumes syntax is not the problem. Focuses on design choices and debugging method.',
  advanced:
    'Mostly Socratic. Tradeoffs, architecture, and why an abstraction is the wrong one.',
};

function hintParagraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'settings-field-hint';
  p.textContent = text;
  return p;
}

/** Render Education Mode controls into the General settings mount. */
export async function renderEducationSettings(mount: HTMLElement): Promise<void> {
  const mode = await detectConfigServer();
  if (!isConfigServerMode(mode)) {
    appendSettingsOfflineHint(
      mount,
      'Education Mode is saved to <code>config.json</code>, so it needs <code>npm start</code>.',
    );
  }

  const current = await loadEducationMeta();

  const { row: toggleRow, input: toggleInput } = createSettingsToggleRow('Education Mode', {
    id: 'settingsEducationEnabled',
    searchKey: 'general.education.enabled',
    checked: current.enabled,
    description:
      'The assistant reviews and guides, but will not write or edit code for you. It can still read your project, run your tests, and open files in the editor to point at the code it means.',
  });
  mount.appendChild(toggleRow);

  const levelWrap = document.createElement('div');
  levelWrap.className = 'settings-education__level';

  const { row: levelRow, select: levelSelect } = createSettingsSelectRow('Teaching level', {
    id: 'settingsEducationLevel',
    searchKey: 'general.education.level',
    value: current.level,
    options: EDUCATION_LEVELS.map((level) => ({
      value: level,
      label: LEVEL_LABELS[level],
    })),
  });
  const levelHint = hintParagraph(LEVEL_HINTS[current.level]);
  levelWrap.append(levelRow, levelHint);
  mount.appendChild(levelWrap);

  // Stated plainly rather than buried: keeping the shell is what makes the tutor
  // useful, and it is also what keeps this short of a guarantee.
  const caveat = hintParagraph(
    'Best effort, not a sandbox. The tutor keeps shell access so it can run your tests, which means unusual commands and connected MCP tools can still reach your files. You can switch this off at any time.',
  );
  caveat.classList.add('settings-education__caveat');
  mount.appendChild(caveat);

  const syncLevelVisibility = (enabled: boolean): void => {
    levelWrap.hidden = !enabled;
    caveat.hidden = !enabled;
  };
  syncLevelVisibility(current.enabled);

  toggleInput.addEventListener('change', () => {
    void (async () => {
      const next = toggleInput.checked;
      try {
        await saveEducationMeta({ enabled: next });
        syncLevelVisibility(next);
        const { refreshEducationBadge } = await import('./composer-education-badge');
        refreshEducationBadge();
        setStatus(
          'ok',
          next
            ? 'Education Mode on. The assistant will guide instead of edit.'
            : 'Education Mode off. Normal editing behaviour is back.',
        );
      } catch {
        toggleInput.checked = !next;
        setStatus('err', 'Could not save Education Mode');
      }
    })();
  });

  levelSelect.addEventListener('change', () => {
    void (async () => {
      const level = levelSelect.value as EducationLevel;
      try {
        await saveEducationMeta({ level });
        levelHint.textContent = LEVEL_HINTS[level] ?? '';
        setStatus('ok', `Teaching level set to ${LEVEL_LABELS[level] ?? level}`);
      } catch {
        setStatus('err', 'Could not save teaching level');
      }
    })();
  });
}
