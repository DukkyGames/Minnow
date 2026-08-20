/**
 * View-model for the Models inspector Load-tab memory instrument.
 *
 * The estimator (`estimateServeMemory`) already knows VRAM vs RAM. This module
 * turns that plus the hardware probe into occupancy rows a developer can read
 * while dragging context length: used / budget, a 0–1 fill, and a tone that
 * matches the old tight-hint thresholds.
 */

import {
  formatServeMemoryEstimate,
  RAM_TERM_FLOOR_GB,
  type ServeMemoryEstimate,
} from './serve-memory-estimate';
import type { GeometrySource } from './model-geometry.d.mts';

/** VRAM fill turns warning. Tight stays at the 92% the old paragraph used. */
export const VRAM_WARN_RATIO = 0.85;
export const VRAM_TIGHT_RATIO = 0.92;
/**
 * RAM is measured against leftover system memory, not the card, so the bar
 * warns earlier than VRAM. Tight matches the previous 55% cutoff.
 */
export const RAM_WARN_RATIO = 0.45;
export const RAM_TIGHT_RATIO = 0.55;

export type LaunchMemoryTone = 'ok' | 'warn' | 'tight' | 'over';

/** Hardware fields the meter actually reads. Tests pass a stub of this. */
export interface LaunchMemoryHardware {
  gpuVramGb?: number | null;
  availableRamGb?: number | null;
  totalRamGb?: number | null;
}

export interface LaunchMemoryMeterRow {
  id: 'vram' | 'ram';
  label: 'VRAM' | 'RAM';
  usedGb: number;
  budgetGb: number | null;
  /** used / budget when a budget exists; null so we never invent a percentage. */
  ratio: number | null;
  /** Fill width, clamped to 0–1. Over-budget rows sit at 1 with tone `over`. */
  fill: number;
  tone: LaunchMemoryTone;
  /** Static strings like `18.1 / 24 GB` or `~18.1 GB`. */
  valueText: string;
}

export interface LaunchMemoryMeterView {
  rows: LaunchMemoryMeterRow[];
  tight: boolean;
  /** Spoken summary; same sentence the old hint used. */
  ariaLabel: string;
  caption: string | null;
  kvNote: string | null;
  title: string | null;
}

export interface LaunchMemoryMeterInput {
  estimate: ServeMemoryEstimate;
  hardware?: LaunchMemoryHardware | null;
}

function finitePositive(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** One decimal when needed; integers stay bare so `24 GB` does not become `24.0`. */
export function formatMemoryGb(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function valueText(usedGb: number, budgetGb: number | null): string {
  if (budgetGb == null) return `~${formatMemoryGb(usedGb)} GB`;
  return `${formatMemoryGb(usedGb)} / ${formatMemoryGb(budgetGb)} GB`;
}

function toneFor(ratio: number | null, warnAt: number, tightAt: number): LaunchMemoryTone {
  if (ratio == null) return 'ok';
  if (ratio > 1) return 'over';
  if (ratio >= tightAt) return 'tight';
  if (ratio >= warnAt) return 'warn';
  return 'ok';
}

function row(
  id: LaunchMemoryMeterRow['id'],
  usedGb: number,
  budgetGb: number | null,
  warnAt: number,
  tightAt: number,
): LaunchMemoryMeterRow {
  const ratio = budgetGb != null && budgetGb > 0 ? usedGb / budgetGb : null;
  const tone = toneFor(ratio, warnAt, tightAt);
  return {
    id,
    label: id === 'vram' ? 'VRAM' : 'RAM',
    usedGb,
    budgetGb,
    ratio,
    fill: ratio == null ? 0 : Math.max(0, Math.min(1, ratio)),
    tone,
    valueText: valueText(usedGb, budgetGb),
  };
}

function captionFor(
  estimate: ServeMemoryEstimate,
  rows: LaunchMemoryMeterRow[],
  geometrySource: GeometrySource,
): { caption: string | null; title: string | null } {
  const over = rows.some((r) => r.tone === 'over');
  const tight = rows.some((r) => r.tone === 'tight' || r.tone === 'over');
  if (over || tight) {
    const text = 'This configuration may exceed the memory Minnow measured on this machine.';
    return { caption: text, title: text };
  }
  if (geometrySource !== 'gguf') {
    const text =
      "Estimated from this model's architecture and size. Exact numbers need the weights on disk.";
    return { caption: text, title: text };
  }
  return { caption: null, title: null };
}

/**
 * Build occupancy rows for the Load tab. VRAM is omitted on CPU-only estimates;
 * RAM is omitted when the host term is below the estimator's display floor.
 */
export function buildLaunchMemoryMeterView(input: LaunchMemoryMeterInput): LaunchMemoryMeterView {
  const { estimate } = input;
  const hw = input.hardware ?? null;
  const budgetVram = finitePositive(hw?.gpuVramGb);
  const budgetRam = finitePositive(hw?.availableRamGb) ?? finitePositive(hw?.totalRamGb);

  const rows: LaunchMemoryMeterRow[] = [];
  if (estimate.vramGb > 0) {
    rows.push(row('vram', estimate.vramGb, budgetVram, VRAM_WARN_RATIO, VRAM_TIGHT_RATIO));
  }
  const showRam = estimate.vramGb <= 0 || estimate.ramGb >= RAM_TERM_FLOOR_GB;
  if (showRam) {
    rows.push(row('ram', estimate.ramGb, budgetRam, RAM_WARN_RATIO, RAM_TIGHT_RATIO));
  }
  if (rows.length === 0) {
    rows.push(row('ram', 0, budgetRam, RAM_WARN_RATIO, RAM_TIGHT_RATIO));
  }

  const tight = rows.some((r) => r.tone === 'tight' || r.tone === 'over');
  const kvNote =
    estimate.kvGbPer1kTokens > 0 ? `${estimate.kvGbPer1kTokens} GB per 1k ctx` : null;
  const { caption, title } = captionFor(estimate, rows, estimate.geometrySource);
  const line = formatServeMemoryEstimate(estimate);
  const ariaLabel = kvNote
    ? `Estimated memory at launch: ${line} (${kvNote})`
    : `Estimated memory at launch: ${line}`;

  return { rows, tight, ariaLabel, caption, kvNote, title };
}
