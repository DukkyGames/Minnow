/**
 * Keeps a failed DOM assertion from exhausting system RAM.
 *
 * `assert.equal(document.querySelector('.x'), null)` is the standard way these
 * suites assert an element is gone. When it *fails*, node:assert inspects the
 * happy-dom node with `depth: 1000, breakLength: Infinity` — that serializes the
 * whole node graph (parents, children, styles, back-references) into millions of
 * lines, then runs Myers diff over them. Myers allocates O(n*m) typed arrays, so
 * the growth is in ArrayBuffers, not the V8 heap: `--max-old-space-size` does not
 * cap it, the loop is synchronous so no timer or watchdog ever runs, and a single
 * test process climbs past 50 GB and takes the machine down with it.
 *
 * Loaded via `--import` from every runner profile (see test/test-config.mjs), so
 * it is in place before any test file evaluates. When either side of a comparison
 * is DOM-like, compare here and report a short descriptor (`<div.board-root>`)
 * instead of handing the node to node:assert's diff machinery.
 */

import assert from 'node:assert';

/** A DOM node — Element, Text, Comment, Document, DocumentFragment. */
function isNode(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.nodeType === 'number' &&
    typeof value.nodeName === 'string'
  );
}

/**
 * NodeList / HTMLCollection. Deliberately narrow: a plain array-like that merely
 * happens to expose `item` must not be routed through the identity fallback.
 */
function isNodeCollection(value) {
  if (Array.isArray(value)) return false;
  if (typeof value.length !== 'number' || typeof value.item !== 'function') return false;
  return value.length === 0 || isNode(value[0]);
}

/** DOM values whose util.inspect output is effectively unbounded. */
function isDomLike(value) {
  if (value === null || typeof value !== 'object') return false;
  if (isNode(value)) return true;
  // happy-dom Window.
  if (value.happyDOM != null && typeof value.happyDOM === 'object') return true;
  return isNodeCollection(value);
}

/** Compact, readable stand-in used in the failure message. */
function describeDom(value) {
  if (isNodeCollection(value)) return `[NodeList length=${value.length}]`;
  if (!isNode(value)) return '[Window]';
  if (value.nodeType === 9) return '[Document]';
  if (value.nodeType === 11) return '[DocumentFragment]';
  if (value.nodeType === 3) {
    return `#text ${JSON.stringify(String(value.nodeValue ?? '').slice(0, 80))}`;
  }
  if (value.nodeType === 8) return '#comment';
  const tag = String(value.nodeName ?? 'node').toLowerCase();
  const id = value.id ? `#${value.id}` : '';
  const classes = String(value.className ?? '').trim();
  const cls = classes ? `.${classes.split(/\s+/).join('.')}` : '';
  return `<${tag}${id}${cls}>`;
}

/** DOM values become descriptors; everything else is inspected as usual. */
function forMessage(value) {
  return isDomLike(value) ? describeDom(value) : value;
}

/**
 * Comparisons used when a DOM value is involved. Deep variants fall back to
 * identity: structurally deep-comparing DOM nodes is never the intent, and it is
 * what detonates in the first place.
 */
const COMPARE = {
  equal: (a, b) => a == b,
  notEqual: (a, b) => a != b,
  strictEqual: (a, b) => Object.is(a, b),
  notStrictEqual: (a, b) => !Object.is(a, b),
  deepEqual: (a, b) => a == b,
  notDeepEqual: (a, b) => a != b,
  deepStrictEqual: (a, b) => Object.is(a, b),
  notDeepStrictEqual: (a, b) => !Object.is(a, b),
};

/** Wrap one comparison so DOM operands never reach node:assert's differ. */
function guard(original, name) {
  const compare = COMPARE[name];
  function guarded(actual, expected, message) {
    if (!isDomLike(actual) && !isDomLike(expected)) {
      return original.call(this, actual, expected, message);
    }
    if (compare(actual, expected)) return undefined;
    throw new assert.AssertionError({
      message,
      actual: forMessage(actual),
      expected: forMessage(expected),
      operator: name,
      stackStartFn: guarded,
    });
  }
  Object.defineProperty(guarded, 'name', { value: name, configurable: true });
  return guarded;
}

/**
 * `assert` and `assert.strict` share function identities (strict.equal is
 * strictEqual), so patch each own property by the semantics it actually has.
 */
function patch(target, name, semantics) {
  const original = target[name];
  if (typeof original !== 'function') return;
  Object.defineProperty(target, name, {
    value: guard(original, semantics),
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

for (const name of Object.keys(COMPARE)) {
  patch(assert, name, name);
}
// assert/strict aliases the loose names onto strict semantics.
for (const [name, semantics] of [
  ['equal', 'strictEqual'],
  ['notEqual', 'notStrictEqual'],
  ['deepEqual', 'deepStrictEqual'],
  ['notDeepEqual', 'notDeepStrictEqual'],
  ['strictEqual', 'strictEqual'],
  ['notStrictEqual', 'notStrictEqual'],
  ['deepStrictEqual', 'deepStrictEqual'],
  ['notDeepStrictEqual', 'notDeepStrictEqual'],
]) {
  patch(assert.strict, name, semantics);
}
