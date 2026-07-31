/**
 * Source Control Center — command palette.
 *
 * Every operation lives here, which is what lets the header stay down to the
 * three things people actually reach for. Advanced git (rebase, cherry-pick,
 * tag, reset) is a search away instead of a row of equally-weighted buttons.
 */

import { el, type SccSectionId } from './scc-shared';

export interface SccCommand {
  id: string;
  /** Shown as the row label. */
  title: string;
  /** Grouping header in the list. */
  group: string;
  /** Extra words that should match this command. */
  keywords?: string;
  /** Right-aligned shortcut hint. */
  shortcut?: string;
  /** Hidden when this returns false (e.g. forge commands off GitHub). */
  available?: () => boolean;
  run: () => void | Promise<void>;
}

export interface SccPaletteHandle {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
}

/**
 * Subsequence match: "cpk" finds "Cherry-pick". Returns a score where lower is
 * a tighter match, or -1 for no match.
 */
export function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const text = haystack.toLowerCase();
  const query = needle.toLowerCase();

  const direct = text.indexOf(query);
  if (direct >= 0) return direct;

  let score = 0;
  let cursor = 0;
  for (const char of query) {
    const found = text.indexOf(char, cursor);
    if (found < 0) return -1;
    // Gaps between matched characters make a match looser.
    score += found - cursor + 1;
    cursor = found + 1;
  }
  return 1000 + score;
}

export function createSccPalette(options: {
  host: HTMLElement;
  getCommands: () => SccCommand[];
  onSectionJump?: (section: SccSectionId) => void;
}): SccPaletteHandle {
  let open = false;
  let commands: SccCommand[] = [];
  let filtered: SccCommand[] = [];
  let activeIndex = 0;

  const overlay = el('div', 'scc-palette-overlay');
  overlay.hidden = true;

  const dialog = el('div', 'scc-palette');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Source control commands');

  const input = el('input', 'scc-palette__input');
  input.type = 'text';
  input.placeholder = 'Run a command';
  input.setAttribute('aria-label', 'Search commands');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'sccPaletteList');
  input.autocomplete = 'off';

  const list = el('div', 'scc-palette__list');
  list.id = 'sccPaletteList';
  list.setAttribute('role', 'listbox');

  dialog.append(input, list);
  overlay.appendChild(dialog);
  options.host.appendChild(overlay);

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close();
  });

  input.addEventListener('input', () => {
    activeIndex = 0;
    render();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void execute(filtered[activeIndex]);
    }
  });

  function move(delta: number): void {
    if (filtered.length === 0) return;
    activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
    paintActive();
  }

  function paintActive(): void {
    const rows = [...list.querySelectorAll<HTMLElement>('.scc-palette__row')];
    rows.forEach((row, index) => {
      const active = index === activeIndex;
      row.classList.toggle('is-active', active);
      row.setAttribute('aria-selected', String(active));
      if (active) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function render(): void {
    const query = input.value.trim();

    const scored = commands
      .filter((command) => command.available?.() !== false)
      .map((command) => ({
        command,
        score: Math.min(
          ...[`${command.group} ${command.title}`, command.keywords ?? '']
            .filter(Boolean)
            .map((text) => {
              const score = fuzzyScore(text, query);
              return score < 0 ? Number.POSITIVE_INFINITY : score;
            }),
        ),
      }))
      .filter((entry) => Number.isFinite(entry.score));

    // Stable within a score so groups do not reshuffle as you type.
    scored.sort((a, b) => a.score - b.score);
    filtered = scored.map((entry) => entry.command);

    if (filtered.length === 0) {
      list.replaceChildren(el('p', 'scc-palette__empty', `No command matches “${query}”`));
      return;
    }

    const frag = document.createDocumentFragment();
    let lastGroup = '';

    filtered.forEach((command, index) => {
      // Group headers only make sense while unfiltered; ranked results ignore them.
      if (!query && command.group !== lastGroup) {
        lastGroup = command.group;
        frag.appendChild(el('div', 'scc-palette__group', command.group));
      }

      const row = el('div', 'scc-palette__row');
      row.setAttribute('role', 'option');
      row.dataset.index = String(index);
      row.appendChild(el('span', 'scc-palette__title', command.title));
      if (query) row.appendChild(el('span', 'scc-palette__group-tag', command.group));
      if (command.shortcut) {
        row.appendChild(el('kbd', 'scc-palette__shortcut', command.shortcut));
      }
      row.addEventListener('mouseenter', () => {
        activeIndex = index;
        paintActive();
      });
      row.addEventListener('click', () => void execute(command));
      frag.appendChild(row);
    });

    list.replaceChildren(frag);
    paintActive();
  }

  async function execute(command?: SccCommand): Promise<void> {
    if (!command) return;
    close();
    await command.run();
  }

  function openPalette(): void {
    if (open) return;
    commands = options.getCommands();
    open = true;
    overlay.hidden = false;
    input.value = '';
    activeIndex = 0;
    render();
    input.focus();
  }

  function close(): void {
    if (!open) return;
    open = false;
    overlay.hidden = true;
    input.value = '';
  }

  return {
    open: openPalette,
    close,
    isOpen: () => open,
    destroy: () => {
      close();
      overlay.remove();
    },
  };
}
