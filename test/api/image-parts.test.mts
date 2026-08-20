/**
 * Image-part stripping: the recovery half of the optimistic vision send.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bodyHasImageParts,
  IMAGE_PART_STRIPPED_NOTE,
  messagesHaveImageParts,
  messagesWithoutImageParts,
  stripImagePartsFromBody,
} from '../../src/api/image-parts.ts';
import type { ApiMessage } from '../../src/types.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const withImage: ApiMessage[] = [
  { role: 'system', content: 'be helpful' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'what is in this shot?' },
      { type: 'image_url', image_url: { url: PNG, detail: 'auto' } },
    ],
  },
];

describe('messagesHaveImageParts', () => {
  it('finds image parts in multimodal content', () => {
    assert.equal(messagesHaveImageParts(withImage), true);
  });

  it('is false for a string-only history', () => {
    assert.equal(
      messagesHaveImageParts([{ role: 'user', content: 'plain text' }]),
      false,
    );
  });
});

describe('messagesWithoutImageParts', () => {
  it('keeps the prose and notes the removed image', () => {
    const out = messagesWithoutImageParts(withImage);
    assert.equal(out.length, 2);
    assert.equal(out[0].content, 'be helpful');
    assert.equal(
      out[1].content,
      `what is in this shot?\n\n${IMAGE_PART_STRIPPED_NOTE}`,
    );
  });

  it('drops tool-screenshot follow-ups entirely', () => {
    const messages: ApiMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'user',
        toolImageFollowUp: true,
        content: [
          { type: 'text', text: '[tool screenshot]' },
          { type: 'image_url', image_url: { url: PNG } },
        ],
      },
    ];
    const out = messagesWithoutImageParts(messages);
    assert.deepEqual(out, [{ role: 'user', content: 'go' }]);
  });

  it('leaves messages without images untouched by identity', () => {
    const messages: ApiMessage[] = [{ role: 'user', content: 'hi' }];
    assert.equal(messagesWithoutImageParts(messages)[0], messages[0]);
  });
});

describe('stripImagePartsFromBody', () => {
  it('preserves every other body field', () => {
    const body = { model: 'm', temperature: 0.7, messages: withImage };
    assert.equal(bodyHasImageParts(body), true);
    const stripped = stripImagePartsFromBody(body);
    assert.equal(stripped.model, 'm');
    assert.equal(stripped.temperature, 0.7);
    assert.equal(bodyHasImageParts(stripped), false);
    // The original body is untouched — the retry must not mutate the first try.
    assert.equal(bodyHasImageParts(body), true);
  });
});
