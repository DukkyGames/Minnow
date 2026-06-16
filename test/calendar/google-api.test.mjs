/**
 * Google Calendar event mapping fixtures.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mapGoogleEvent } from '../../server/calendar/google-api.js';

describe('mapGoogleEvent', () => {
  test('maps timed Google event fields', () => {
    const mapped = mapGoogleEvent({
      id: 'evt-1',
      etag: '"etag-1"',
      summary: 'Standup',
      description: 'Daily sync',
      location: 'Zoom',
      start: { dateTime: '2024-06-01T15:00:00Z' },
      end: { dateTime: '2024-06-01T15:30:00Z' },
    });

    assert.equal(mapped.title, 'Standup');
    assert.equal(mapped.location, 'Zoom');
    assert.equal(mapped.allDay, false);
    assert.equal(mapped.remoteHref, 'evt-1');
  });
});
