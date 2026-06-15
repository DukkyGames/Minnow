import type { WindowBounds } from './window-manager';

/** Window-manager instance id for the calendar event create/edit surface. */
export const CALENDAR_EVENT_EDITOR_INSTANCE_ID = 'calendar-event-editor';

/** Default calendar window size (first open, before persistence). */
export const CALENDAR_WINDOW_WIDTH = 960;
export const CALENDAR_WINDOW_HEIGHT = 640;

/** Minimum resize size for the calendar window frame. */
export const CALENDAR_WINDOW_MIN_WIDTH = 520;
export const CALENDAR_WINDOW_MIN_HEIGHT = 400;

/** Center the default calendar window within the OS stage. */
export function centeredCalendarBounds(): WindowBounds {
  const stage = document.getElementById('osStage') ?? document.body;
  const rect = stage.getBoundingClientRect();
  const stageWidth = rect.width || stage.clientWidth || CALENDAR_WINDOW_WIDTH;
  const stageHeight = rect.height || stage.clientHeight || CALENDAR_WINDOW_HEIGHT;
  const width = Math.min(CALENDAR_WINDOW_WIDTH, stageWidth);
  const height = Math.min(CALENDAR_WINDOW_HEIGHT, stageHeight);
  return {
    x: Math.max(0, Math.round((stageWidth - width) / 2)),
    y: Math.max(0, Math.round((stageHeight - height) / 2)),
    width,
    height,
  };
}
