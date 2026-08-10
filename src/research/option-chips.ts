/**
 * Composer option chips.
 *
 * Each chip reads its own current value, so the settings a run will use stay
 * visible while you type instead of hiding behind an "Options" toggle. The
 * chips are only a face: the native <select> / <input> controls inside each
 * popover remain the source of truth, which keeps keyboard and screen-reader
 * behaviour standard and leaves `readStartOptions` reading the same elements.
 */

interface ChipSpec {
  chipId: string;
  popId: string;
  /** Label text, or null for icon-only chips. */
  value: (() => string) | null;
  /** Whether the chip is set to something other than its default. */
  isSet: () => boolean;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function selectText(id: string): string {
  const select = el<HTMLSelectElement>(id);
  if (!select) {
    return '';
  }
  return select.options[select.selectedIndex]?.textContent?.trim() ?? '';
}

function roundsLabel(): string {
  const raw = el<HTMLSelectElement>('researchMaxRounds')?.value ?? 'auto';
  if (!raw || raw === 'auto' || raw === '0') {
    return 'Auto depth';
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return 'Auto depth';
  }
  return `${n} round${n === 1 ? '' : 's'}`;
}

function categoryLabel(): string {
  const value = el<HTMLSelectElement>('researchCategory')?.value ?? '';
  return value ? selectText('researchCategory') : 'Auto topic';
}

function scopeLabel(): string {
  return selectText('researchScope') || 'Web';
}

function engineOverridden(): boolean {
  return Boolean(el<HTMLSelectElement>('researchSearchProvider')?.value?.trim());
}

const CHIPS: ChipSpec[] = [
  {
    chipId: 'chipResearchScope',
    popId: 'popResearchScope',
    value: scopeLabel,
    isSet: () => (el<HTMLSelectElement>('researchScope')?.value ?? 'web') !== 'web',
  },
  {
    chipId: 'chipResearchRounds',
    popId: 'popResearchRounds',
    value: roundsLabel,
    isSet: () => {
      const raw = el<HTMLSelectElement>('researchMaxRounds')?.value ?? 'auto';
      return raw !== 'auto' && raw !== '0';
    },
  },
  {
    chipId: 'chipResearchCategory',
    popId: 'popResearchCategory',
    value: categoryLabel,
    isSet: () => Boolean(el<HTMLSelectElement>('researchCategory')?.value),
  },
  {
    chipId: 'chipResearchEngine',
    popId: 'popResearchEngine',
    value: null,
    isSet: engineOverridden,
  },
];

/** Close every option popover. */
export function closeResearchOptionPopovers(): void {
  for (const spec of CHIPS) {
    const pop = el(spec.popId);
    const chip = el(spec.chipId);
    if (pop) {
      pop.hidden = true;
    }
    chip?.setAttribute('aria-expanded', 'false');
  }
}

/** Repaint every chip from its underlying control. */
export function syncResearchOptionChips(): void {
  for (const spec of CHIPS) {
    const chip = el(spec.chipId);
    if (!chip) {
      continue;
    }
    const set = spec.isSet();
    chip.classList.toggle('is-set', set);
    if (spec.value) {
      const slot = chip.querySelector('[data-chip-value]');
      if (slot) {
        slot.textContent = spec.value();
      }
    }
  }
  const dot = el('researchEngineDot');
  if (dot) {
    dot.hidden = !engineOverridden();
  }
}

/** Disable the chips while a run owns the composer. */
export function setResearchOptionChipsDisabled(disabled: boolean): void {
  if (disabled) {
    closeResearchOptionPopovers();
  }
  for (const spec of CHIPS) {
    const chip = el<HTMLButtonElement>(spec.chipId);
    if (chip) {
      chip.disabled = disabled;
    }
  }
}

let bound = false;

/** Wire chip toggles, dismissal, and value sync. Safe to call more than once. */
export function initResearchOptionChips(): void {
  if (bound) {
    syncResearchOptionChips();
    return;
  }
  bound = true;

  for (const spec of CHIPS) {
    const chip = el<HTMLButtonElement>(spec.chipId);
    const pop = el(spec.popId);
    if (!chip || !pop) {
      continue;
    }
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const willOpen = pop.hidden;
      closeResearchOptionPopovers();
      if (willOpen) {
        pop.hidden = false;
        chip.setAttribute('aria-expanded', 'true');
        pop.querySelector<HTMLElement>('select, input, button')?.focus();
      }
    });
    pop.addEventListener('click', (ev) => ev.stopPropagation());
    pop.addEventListener('change', () => syncResearchOptionChips());
    pop.addEventListener('input', () => syncResearchOptionChips());
  }

  document.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement | null)?.closest('.rs-opt')) {
      return;
    }
    closeResearchOptionPopovers();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') {
      return;
    }
    const open = CHIPS.some((spec) => el(spec.popId)?.hidden === false);
    if (!open) {
      return;
    }
    ev.stopPropagation();
    closeResearchOptionPopovers();
  });

  syncResearchOptionChips();
}

/** Reset module state (tests). */
export function resetResearchOptionChipsForTests(): void {
  bound = false;
}
