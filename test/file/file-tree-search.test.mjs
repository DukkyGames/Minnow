import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const filter = await import('../../src/ui/file-tree-filter.ts');
const search = await import('../../src/ui/file-tree-search.ts');

let renderCalls = 0;
let serverOnline = true;

search.registerFileTreeFilterRender(() => {
  renderCalls += 1;
});
search.setServerOnlineCheckForTests(() => serverOnline);

function setupSearchDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.setTimeout = window.setTimeout.bind(window);
  globalThis.clearTimeout = window.clearTimeout.bind(window);
  document.body.innerHTML = `
    <div class="file-tree-search-wrap">
      <input type="search" id="fileTreeSearch" class="file-tree-search" />
      <button type="button" class="icon-btn file-tree-search-clear hidden" id="btnFileTreeSearchClear"></button>
    </div>
    <div id="fileTreeHost"></div>
  `;
}

describe('file-tree-search', () => {
  test('init disables input when server offline', () => {
    setupSearchDom();
    serverOnline = false;
    search.setFilterQuery('');
    search.initFileTreeSearch();
    const input = document.getElementById('fileTreeSearch');
    assert.equal(input?.disabled, true);
    assert.match(input?.placeholder ?? '', /Server required/i);
    serverOnline = true;
  });

  test('debounced input schedules tree render callback', async () => {
    setupSearchDom();
    serverOnline = true;
    filter.setFilterQueryValue('');
    search.initFileTreeSearch();
    renderCalls = 0;

    const win = document.defaultView;
    const input = document.getElementById('fileTreeSearch');
    assert.ok(input);
    input.value = 'app';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));

    assert.equal(search.getFilterQuery(), 'app');
    assert.equal(renderCalls, 0);

    await new Promise((r) => setTimeout(r, 250));
    assert.ok(renderCalls >= 1);
  });

  test('clear button resets query', () => {
    setupSearchDom();
    serverOnline = true;
    search.setFilterQuery('keep');
    search.initFileTreeSearch();
    search.setFilterQuery('tmp');
    const clear = document.getElementById('btnFileTreeSearchClear');
    assert.ok(clear);
    clear.classList.remove('hidden');
    clear.click();
    assert.equal(search.getFilterQuery(), '');
    assert.equal(document.getElementById('fileTreeSearch')?.value, '');
  });
});
