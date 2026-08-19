import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  captureDescriptionSeed,
  captureItemsEqual,
  capturePayloadToLinks,
  captureTitleSeed,
  emptyCapturePayload,
  isCapturePayloadEmpty,
  mergeCapturePayloads,
  parseCapturePayloadJson,
  type CapturePayload,
} from '../../src/issues/capture-payload.ts';

function codePayload(): CapturePayload {
  return {
    sourceLabel: 'Editor selection',
    items: [
      {
        kind: 'code',
        label: 'foo.ts L12-14',
        codeRef: { path: 'src/foo.ts', startLine: 12, endLine: 14 },
        text: 'const x = 1;\nthrow new Error("nope");',
      },
    ],
  };
}

describe('captureTitleSeed', () => {
  it('prefers an explicit title', () => {
    assert.equal(captureTitleSeed({ title: '  Crash on save  ', items: [] }), 'Crash on save');
  });

  it('falls back to the first non-empty line of captured text', () => {
    assert.equal(captureTitleSeed(codePayload()), 'const x = 1;');
  });

  it('falls back to the label of an item the issue is about', () => {
    assert.equal(
      captureTitleSeed({ items: [{ kind: 'git', label: 'a1b2c3d4' }] }),
      'a1b2c3d4',
    );
  });

  it('never titles an issue after ambient context alone', () => {
    // The chat you happened to be in is context, not a subject — seeding
    // "Current chat" would be worse than an empty field with a placeholder.
    assert.equal(
      captureTitleSeed({ items: [{ kind: 'chat', label: 'Current chat', chatId: 'c1' }] }),
      '',
    );
  });

  it('returns empty for an empty payload rather than inventing a title', () => {
    assert.equal(captureTitleSeed(emptyCapturePayload()), '');
  });

  it('truncates long seeds with an ellipsis', () => {
    const seed = captureTitleSeed({ title: 'x'.repeat(300), items: [] });
    assert.equal(seed.length, 120);
    assert.ok(seed.endsWith('…'));
  });
});

describe('captureDescriptionSeed', () => {
  it('fences captured text under its code label', () => {
    const body = captureDescriptionSeed(codePayload());
    assert.match(body, /^foo\.ts L12-14\n```\n/);
    assert.ok(body.endsWith('```'));
  });

  it('uses a longer fence when the text already contains one', () => {
    const body = captureDescriptionSeed({
      items: [{ kind: 'text', label: 'Output', text: 'before\n```\ninner\n```\nafter' }],
    });
    assert.ok(body.startsWith('````'));
  });

  it('is empty when nothing carries text', () => {
    assert.equal(captureDescriptionSeed({ items: [{ kind: 'git', label: 'main' }] }), '');
  });
});

describe('capturePayloadToLinks', () => {
  it('splits items into the link kinds the store understands', () => {
    const links = capturePayloadToLinks({
      items: [
        { kind: 'code', label: 'a', codeRef: { path: 'src/a.ts' } },
        { kind: 'git', label: 'b', gitLink: { kind: 'commit', ref: 'abc' } },
        { kind: 'chat', label: 'c', chatId: 'chat-1' },
        { kind: 'chat', label: 'c again', chatId: 'chat-1' },
        { kind: 'issue', label: 'MIN-1', issueRef: { issueId: 'MIN-1', kind: 'related' } },
        { kind: 'text', label: 'no link', text: 'hi' },
      ],
    });
    assert.deepEqual(links.codeRefs, [{ path: 'src/a.ts' }]);
    assert.equal(links.gitLinks.length, 1);
    assert.deepEqual(links.chatIds, ['chat-1']);
    assert.equal(links.issueRefs[0].issueId, 'MIN-1');
  });
});

describe('mergeCapturePayloads', () => {
  it('dedupes identical items and lets the newer title win', () => {
    const base = codePayload();
    const merged = mergeCapturePayloads(base, {
      title: 'Dropped',
      items: [...codePayload().items, { kind: 'git', label: 'main', gitLink: { kind: 'branch', ref: 'main' } }],
    });
    assert.equal(merged.items.length, 2);
    assert.equal(merged.title, 'Dropped');
  });

  it('keeps the base source label when the extra has none', () => {
    const merged = mergeCapturePayloads(codePayload(), { items: [] });
    assert.equal(merged.sourceLabel, 'Editor selection');
  });
});

describe('captureItemsEqual', () => {
  it('compares code refs by path and range', () => {
    const a = { kind: 'code' as const, label: 'a', codeRef: { path: 'x.ts', startLine: 1, endLine: 2 } };
    const b = { kind: 'code' as const, label: 'different label', codeRef: { path: 'x.ts', startLine: 1, endLine: 2 } };
    const c = { kind: 'code' as const, label: 'a', codeRef: { path: 'x.ts', startLine: 3, endLine: 4 } };
    assert.equal(captureItemsEqual(a, b), true);
    assert.equal(captureItemsEqual(a, c), false);
  });

  it('never equates items of different kinds', () => {
    assert.equal(
      captureItemsEqual({ kind: 'text', label: 'x' }, { kind: 'file', label: 'x' }),
      false,
    );
  });
});

describe('parseCapturePayloadJson', () => {
  it('round-trips a serialized payload', () => {
    const parsed = parseCapturePayloadJson(JSON.stringify(codePayload()));
    assert.ok(parsed);
    assert.equal(parsed.items[0].codeRef?.path, 'src/foo.ts');
    assert.equal(parsed.items[0].codeRef?.startLine, 12);
  });

  it('rejects malformed JSON', () => {
    assert.equal(parseCapturePayloadJson('{not json'), null);
  });

  it('drops items with an unknown kind or no label', () => {
    const parsed = parseCapturePayloadJson(
      JSON.stringify({
        title: 'kept',
        items: [
          { kind: 'nope', label: 'x' },
          { kind: 'text', label: '   ' },
          { kind: 'text', label: 'good' },
        ],
      }),
    );
    assert.ok(parsed);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].label, 'good');
  });

  it('drops a git link with an unrecognized kind rather than trusting it', () => {
    const parsed = parseCapturePayloadJson(
      JSON.stringify({
        items: [{ kind: 'git', label: 'x', gitLink: { kind: 'evil', ref: 'abc' } }],
      }),
    );
    assert.ok(parsed);
    assert.equal(parsed.items[0].gitLink, undefined);
  });

  it('returns null when nothing survives sanitizing', () => {
    assert.equal(parseCapturePayloadJson(JSON.stringify({ items: [{ kind: 'nope' }] })), null);
  });
});

describe('isCapturePayloadEmpty', () => {
  it('is true only when there is nothing to file', () => {
    assert.equal(isCapturePayloadEmpty(emptyCapturePayload()), true);
    assert.equal(isCapturePayloadEmpty({ title: 'x', items: [] }), false);
    assert.equal(isCapturePayloadEmpty(codePayload()), false);
  });
});
