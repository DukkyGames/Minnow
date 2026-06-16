/**
 * Microsoft Graph calendar event mapping fixtures.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mapGraphCalendarEvent } from '../../server/calendar/graph-calendar.js';

describe('mapGraphCalendarEvent', () => {
  test('maps Graph calendar event fields', () => {
    const mapped = mapGraphCalendarEvent({
      id: 'graph-evt-9',
      '@odata.etag': 'W/"etag"',
      subject: '1:1',
      body: { content: 'Agenda notes' },
      location: { displayName: 'Room A' },
      isAllDay: true,
      start: { dateTime: '2024-06-02T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2024-06-02T23:59:59.0000000', timeZone: 'UTC' },
    });

    assert.equal(mapped.title, '1:1');
    assert.equal(mapped.allDay, true);
    assert.equal(mapped.remoteHref, 'graph-evt-9');
  });
});
