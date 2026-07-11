/**
 * Annotations panel (MIN-368): dead-anchor badge rendering, filtering by linked chat, and
 * jump-both-ways / bulk-delete wiring. Pure DOM component — no preview/chat plumbing here
 * (preview-panel.ts wires the real callbacks); see annotation-links.test.mts for the
 * link-stamping-on-send behavior this panel reads.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { mountAnnotationsPanel, type AnnotationsPanelItem } from '../../src/design/annotations-panel.ts';
import type { PageAnnotations } from '../../src/design/annotation-store.ts';
import type { AnchorCandidate, CommentPin, DesignShape } from '../../src/design/shape-model.ts';

describe('annotations panel (MIN-368)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function shape(id: string, anchor: DesignShape['anchor'], links?: DesignShape['links']): DesignShape {
    return { id, kind: 'rect', rect: { x: 0, y: 0, width: 10, height: 10 }, anchor, createdAt: 1, links };
  }

  function pin(id: string, anchor: CommentPin['anchor'], links?: CommentPin['links']): CommentPin {
    return { id, index: 1, x: 0, y: 0, anchor, notes: [], links };
  }

  function callbacks() {
    const highlighted: AnnotationsPanelItem[] = [];
    const jumps: Array<{ chatId: string; turnId: string }> = [];
    const bulkDeletes: Array<{ shapeIds: string[]; pinIds: string[] }> = [];
    return {
      onHighlight: (item: AnnotationsPanelItem) => highlighted.push(item),
      onJumpToChat: (chatId: string, turnId: string) => jumps.push({ chatId, turnId }),
      onBulkDelete: (ids: { shapeIds: string[]; pinIds: string[] }) => {
        bulkDeletes.push(ids);
      },
      highlighted,
      jumps,
      bulkDeletes,
    };
  }

  test('renders one row per shape/pin', () => {
    const cb = callbacks();
    const handle = mountAnnotationsPanel(host, cb);
    const data: PageAnnotations = {
      shapes: [shape('s1', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 })],
      pins: [pin('p1', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 })],
    };
    handle.setData(data);
    const rows = host.querySelectorAll('.mn-design-annotations-panel__row');
    assert.equal(rows.length, 2);
    handle.destroy();
  });

  test('shows "moved/removed" badge only for a dead element anchor (uid AND selector both fail)', () => {
    const cb = callbacks();
    const handle = mountAnnotationsPanel(host, cb);
    const data: PageAnnotations = {
      shapes: [
        shape('surviving', { type: 'element', uid: 7, selector: 'button.cta' }),
        shape('dead', { type: 'element', uid: 999, selector: 'button.gone' }),
      ],
      pins: [],
    };
    const candidates: AnchorCandidate[] = [
      { uid: 7, selector: 'button.cta', rect: { x: 0, y: 0, width: 1, height: 1 } },
    ];
    handle.setData(data, candidates);

    const survivingRow = host.querySelector('[data-item-id="surviving"]')!;
    const deadRow = host.querySelector('[data-item-id="dead"]')!;
    assert.equal(survivingRow.querySelector('.mn-design-annotations-panel__row-badge'), null);
    assert.ok(deadRow.querySelector('.mn-design-annotations-panel__row-badge'));
    assert.equal(
      deadRow.querySelector('.mn-design-annotations-panel__row-badge')?.textContent,
      'moved/removed',
    );
    handle.destroy();
  });

  test('filters the list to marks linked to the selected chat', () => {
    const cb = callbacks();
    const handle = mountAnnotationsPanel(host, cb);
    const data: PageAnnotations = {
      shapes: [
        shape('linked-a', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 }, [
          { chatId: 'chat-a', turnId: '1', at: 1 },
        ]),
        shape('linked-b', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 }, [
          { chatId: 'chat-b', turnId: '2', at: 2 },
        ]),
        shape('unlinked', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 }),
      ],
      pins: [],
    };
    handle.setData(data);
    assert.equal(host.querySelectorAll('.mn-design-annotations-panel__row').length, 3);
    assert.deepEqual(handle.getLinkedChatIds(), ['chat-a', 'chat-b']);

    handle.setChatFilter('chat-a');
    const visibleIds = [...host.querySelectorAll('.mn-design-annotations-panel__row')].map(
      (r) => (r as HTMLElement).dataset.itemId,
    );
    assert.deepEqual(visibleIds, ['linked-a']);

    handle.setChatFilter(null);
    assert.equal(host.querySelectorAll('.mn-design-annotations-panel__row').length, 3);
    handle.destroy();
  });

  test('clicking a link chip jumps to that chat turn', () => {
    const cb = callbacks();
    const handle = mountAnnotationsPanel(host, cb);
    handle.setData({
      shapes: [
        shape('s1', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 }, [
          { chatId: 'chat-a', turnId: '9', at: 2 },
          { chatId: 'chat-a', turnId: '3', at: 1 },
        ]),
      ],
      pins: [],
    });
    const chip = host.querySelector('.mn-design-annotations-panel__link-chip') as HTMLButtonElement;
    assert.ok(chip);
    chip.click();
    assert.deepEqual(cb.jumps, [{ chatId: 'chat-a', turnId: '9' }]);
    handle.destroy();
  });

  test('clicking highlight invokes onHighlight with the item', () => {
    const cb = callbacks();
    const handle = mountAnnotationsPanel(host, cb);
    handle.setData({ shapes: [shape('s1', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 })], pins: [] });
    const btn = host.querySelector('.mn-design-annotations-panel__row-highlight') as HTMLButtonElement;
    btn.click();
    assert.equal(cb.highlighted.length, 1);
    assert.equal(cb.highlighted[0]?.id, 's1');
    handle.destroy();
  });

  test('bulk delete: selecting rows enables the button; clicking sends shape+pin id lists', () => {
    const cb = callbacks();
    const handle = mountAnnotationsPanel(host, cb);
    handle.setData({
      shapes: [shape('s1', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 })],
      pins: [pin('p1', { type: 'page', x: 0, y: 0, scrollX: 0, scrollY: 0 })],
    });

    const deleteBtn = host.querySelector('.mn-design-annotations-panel__bulk-delete') as HTMLButtonElement;
    assert.equal(deleteBtn.disabled, true);

    const checkboxes = host.querySelectorAll('.mn-design-annotations-panel__row-check');
    (checkboxes[0] as HTMLInputElement).click();
    (checkboxes[1] as HTMLInputElement).click();

    assert.equal(deleteBtn.disabled, false);
    assert.deepEqual(handle.getSelection(), { shapeIds: ['s1'], pinIds: ['p1'] });

    deleteBtn.click();
    assert.deepEqual(cb.bulkDeletes, [{ shapeIds: ['s1'], pinIds: ['p1'] }]);
    handle.destroy();
  });

  test('collapse toggle flips the collapsed class and aria-expanded', () => {
    const cb = callbacks();
    const handle = mountAnnotationsPanel(host, cb);
    assert.equal(handle.isCollapsed(), false);
    const collapseBtn = host.querySelector('.mn-design-annotations-panel__collapse') as HTMLButtonElement;
    collapseBtn.click();
    assert.equal(handle.isCollapsed(), true);
    assert.equal(collapseBtn.getAttribute('aria-expanded'), 'false');
    collapseBtn.click();
    assert.equal(handle.isCollapsed(), false);
    handle.destroy();
  });

  test('empty state renders when there are no marks (or the filter matches none)', () => {
    const cb = callbacks();
    const handle = mountAnnotationsPanel(host, cb);
    handle.setData({ shapes: [], pins: [] });
    assert.ok(host.querySelector('.mn-design-annotations-panel__empty'));
    assert.equal(host.querySelectorAll('.mn-design-annotations-panel__row').length, 0);
    handle.destroy();
  });
});
