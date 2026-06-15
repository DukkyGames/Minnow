/**
 * Human-readable schedule labels and cron builder helpers for the Scheduler UI.
 */

import { CronExpressionParser } from 'cron-parser';

export type CronPattern = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

export interface CronUiState {
  pattern: CronPattern;
  minute: number;
  hour: number;
  /** 0 = Sunday … 6 = Saturday */
  weekDays: number[];
  customExpression: string;
}

export interface ScheduleUiState {
  kind: 'interval' | 'cron';
  intervalValue: string;
  cron: CronUiState;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const DEFAULT_CRON: CronUiState = {
  pattern: 'daily',
  minute: 0,
  hour: 9,
  weekDays: [1],
  customExpression: '0 9 * * *',
};

/** Friendly labels for schedule kind select options. */
export const SCHEDULE_KIND_OPTIONS: ReadonlyArray<{ value: 'interval' | 'cron'; label: string }> = [
  { value: 'interval', label: 'Repeat every' },
  { value: 'cron', label: 'At set times' },
];

/** Friendly labels for cron pattern presets. */
export const CRON_PATTERN_OPTIONS: ReadonlyArray<{ value: CronPattern; label: string }> = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon-Fri)' },
  { value: 'weekly', label: 'Specific days' },
  { value: 'custom', label: 'Custom expression' },
];

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseCronField(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function parseWeekDaysField(value: string): number[] | null {
  if (value === '*') return null;
  const days: number[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (/^\d+$/.test(trimmed)) {
      const day = Number.parseInt(trimmed, 10);
      if (day >= 0 && day <= 6) days.push(day);
      continue;
    }
    const range = /^(\d)-(\d)$/.exec(trimmed);
    if (range) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      if (start <= end) {
        for (let d = start; d <= end; d += 1) {
          if (d >= 0 && d <= 6) days.push(d);
        }
      }
      continue;
    }
    return null;
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Map stored schedule into editor UI state. */
export function scheduleToUi(schedule: { kind: string; value: string }): ScheduleUiState {
  const kind = schedule.kind === 'cron' ? 'cron' : 'interval';
  if (kind === 'interval') {
    return {
      kind,
      intervalValue: schedule.value.trim() || '5m',
      cron: { ...DEFAULT_CRON },
    };
  }

  const expr = schedule.value.trim();
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) {
    return {
      kind,
      intervalValue: '5m',
      cron: { ...DEFAULT_CRON, pattern: 'custom', customExpression: expr || DEFAULT_CRON.customExpression },
    };
  }

  const [minField, hourField, dom, month, dow] = parts;
  const minute = parseCronField(minField);
  const hour = parseCronField(hourField);

  if (minute != null && hourField === '*' && dom === '*' && month === '*' && dow === '*') {
    return {
      kind,
      intervalValue: '5m',
      cron: { pattern: 'hourly', minute, hour: 9, weekDays: [1], customExpression: expr },
    };
  }

  if (minute != null && hour != null && dom === '*' && month === '*' && dow === '*') {
    return {
      kind,
      intervalValue: '5m',
      cron: { pattern: 'daily', minute, hour, weekDays: [1], customExpression: expr },
    };
  }

  if (minute != null && hour != null && dom === '*' && month === '*' && dow === '1-5') {
    return {
      kind,
      intervalValue: '5m',
      cron: { pattern: 'weekdays', minute, hour, weekDays: [1, 2, 3, 4, 5], customExpression: expr },
    };
  }

  const weekDays = parseWeekDaysField(dow);
  if (
    minute != null &&
    hour != null &&
    dom === '*' &&
    month === '*' &&
    weekDays &&
    weekDays.length > 0 &&
    dow !== '1-5'
  ) {
    return {
      kind,
      intervalValue: '5m',
      cron: { pattern: 'weekly', minute, hour, weekDays, customExpression: expr },
    };
  }

  return {
    kind,
    intervalValue: '5m',
    cron: { ...DEFAULT_CRON, pattern: 'custom', customExpression: expr || DEFAULT_CRON.customExpression },
  };
}

/** Build the cron five-field expression from UI state. */
export function cronUiToExpression(cron: CronUiState): string {
  const minute = clampInt(cron.minute, 0, 59);
  const hour = clampInt(cron.hour, 0, 23);

  switch (cron.pattern) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`;
    case 'weekly': {
      const days = [...new Set(cron.weekDays.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
      if (days.length === 0) return `${minute} ${hour} * * 1`;
      return `${minute} ${hour} * * ${days.join(',')}`;
    }
    case 'custom':
      return cron.customExpression.trim();
    default:
      return DEFAULT_CRON.customExpression;
  }
}

/** Convert editor UI state into the persisted schedule shape. */
export function uiToSchedule(ui: ScheduleUiState): { kind: 'interval' | 'cron'; value: string } {
  if (ui.kind === 'interval') {
    return { kind: 'interval', value: ui.intervalValue.trim() || '5m' };
  }
  return { kind: 'cron', value: cronUiToExpression(ui.cron) };
}

function formatLocalTime(hour: number, minute: number): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatWeekDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return 'no days selected';
  if (sorted.length === 7) return 'every day';
  if (sorted.join(',') === '1,2,3,4,5') return 'weekdays';
  if (sorted.length === 1) return `Every ${WEEKDAY_NAMES[sorted[0]]}`;
  const names = sorted.map((d) => WEEKDAY_LABELS[d]);
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function describeInterval(value: string): string {
  const raw = value.trim();
  const match = /^(\d+)(s|m|h)$/i.exec(raw);
  if (!match) return `Every ${raw}`;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 's') {
    return amount === 1 ? 'Every second' : `Every ${amount} seconds`;
  }
  if (unit === 'm') {
    return amount === 1 ? 'Every minute' : `Every ${amount} minutes`;
  }
  return amount === 1 ? 'Every hour' : `Every ${amount} hours`;
}

function describeCronExpression(expression: string): string {
  const ui = scheduleToUi({ kind: 'cron', value: expression });
  const { pattern, minute, hour, weekDays } = ui.cron;

  switch (pattern) {
    case 'hourly':
      return minute === 0 ? 'Every hour on the hour' : `Every hour at :${String(minute).padStart(2, '0')}`;
    case 'daily':
      return `Daily at ${formatLocalTime(hour, minute)}`;
    case 'weekdays':
      return `Weekdays at ${formatLocalTime(hour, minute)}`;
    case 'weekly':
      return `${formatWeekDays(weekDays)} at ${formatLocalTime(hour, minute)}`;
    case 'custom':
      return `Custom schedule (${expression.trim()})`;
    default:
      return expression.trim();
  }
}

/** Short label for job rows and summaries. */
export function describeSchedule(schedule: { kind: string; value: string }): string {
  const kind = schedule.kind === 'cron' ? 'cron' : 'interval';
  const value = schedule.value.trim();
  if (!value) return 'Not configured';
  if (kind === 'interval') return describeInterval(value);
  return describeCronExpression(value);
}

/** Validate cron and return the next local run time for inline preview. */
export function previewNextCronRun(
  expression: string,
  now: Date = new Date(),
): { ok: true; nextLabel: string } | { ok: false; error: string } {
  const raw = expression.trim();
  if (!raw) return { ok: false, error: 'Enter a schedule' };

  if (scheduleToUi({ kind: 'cron', value: raw }).cron.pattern === 'weekly') {
    const days = scheduleToUi({ kind: 'cron', value: raw }).cron.weekDays;
    if (days.length === 0) {
      return { ok: false, error: 'Pick at least one day' };
    }
  }

  try {
    const interval = CronExpressionParser.parse(raw, { currentDate: now });
    const next = interval.next().toDate();
    return { ok: true, nextLabel: next.toLocaleString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Validate schedule UI before save (client-side hints; server remains authoritative). */
export function validateScheduleUi(
  ui: ScheduleUiState,
): { ok: true } | { ok: false; error: string } {
  if (ui.kind === 'interval') {
    const value = ui.intervalValue.trim();
    if (!value) return { ok: false, error: 'Enter an interval like 5m or 2h' };
    if (!/^\d+(s|m|h)$/i.test(value)) {
      return { ok: false, error: 'Interval must look like 60s, 5m, or 2h' };
    }
    return { ok: true };
  }

  if (ui.cron.pattern === 'weekly' && ui.cron.weekDays.length === 0) {
    return { ok: false, error: 'Pick at least one day' };
  }

  const expression = cronUiToExpression(ui.cron);
  const preview = previewNextCronRun(expression);
  if (!preview.ok) return preview;
  return { ok: true };
}

export { WEEKDAY_LABELS };
