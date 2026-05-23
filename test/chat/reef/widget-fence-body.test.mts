/**
 * Reef widget fence body validation (corrupt stream / nested markers).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { prepareReefWidgetHtml } from '../../../src/chat/reef/widget-fence-body.ts';

const VALID_CALC_SNIPPET = `<style>
.rw { display: flex; }
</style>
<div class="rw"><div class="calc-container">OK</div></div>
<script type="module">
import React from 'react';
</script>`;

describe('widget-fence-body', () => {
  test('accepts clean widget HTML', () => {
    const result = prepareReefWidgetHtml(VALID_CALC_SNIPPET);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.value.html, /calc-container/);
    assert.equal(result.value.recoveredFromDuplicateMarkers, false);
  });

  test('rejects empty fence', () => {
    const result = prepareReefWidgetHtml('   ');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.errors[0], /empty/i);
  });

  test('rejects truncated HTML after duplicate fence markers', () => {
    const corrupt = `<style>.a { color: var(--text); }</style><div>a</div>
\`\`\`reef-widget
<style>
.calc-main { font-size: 1.75rem;
`;
    const result = prepareReefWidgetHtml(corrupt);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.errors.join(' '), /style/i);
  });

  test('recovers last segment when fence marker was repeated', () => {
    const raw = `<style>.old{}</style><div>old</div>
\`\`\`reef-widget
${VALID_CALC_SNIPPET}`;
    const result = prepareReefWidgetHtml(raw);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.recoveredFromDuplicateMarkers, true);
    assert.match(result.value.html, /calc-container/);
    assert.doesNotMatch(result.value.html, /\.old/);
  });

  test('rejects unclosed style tag', () => {
    const result = prepareReefWidgetHtml('<style>.x { color: red; }<div></div>');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.errors.join(' '), /style/i);
  });
});
