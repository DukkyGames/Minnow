/**
 * Jump-to-latest and the code-change strip must share one dock and stay on one line.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const messagesCss = readFileSync(join(root, 'src/styles/messages.css'), 'utf8');
const stripCss = readFileSync(join(root, 'src/styles/code-change-strip.css'), 'utf8');

describe('chat viewport float dock', () => {
  test('index.html stacks jump chip above the code-change strip inside the dock', () => {
    const dockStart = html.indexOf('class="chat-viewport-dock"');
    const dockEnd = html.indexOf('id="toolApprovalHost"');
    assert.ok(dockStart > 0 && dockEnd > dockStart);
    const dock = html.slice(dockStart, dockEnd);
    const jump = dock.indexOf('id="chatJumpLatest"');
    const wrap = dock.indexOf('class="code-change-strip-wrap"');
    assert.ok(jump >= 0, 'jump chip lives in the dock');
    assert.ok(wrap > jump, 'code-change wrap follows the jump chip in the dock');
  });

  test('dock is a column so the jump chip cannot overlap the strip', () => {
    assert.match(messagesCss, /\.chat-viewport-dock\s*\{[^}]*flex-direction:\s*column/s);
    assert.match(messagesCss, /\.chat-viewport-dock\s*\{[^}]*gap:\s*8px/s);
    assert.match(
      messagesCss,
      /\.chat-viewport-dock \.chat-jump-latest\.hidden\s*\{[^}]*display:\s*none\s*!important/s,
    );
  });

  test('code-change row does not wrap label or stats onto two lines', () => {
    assert.match(stripCss, /\.code-change-strip-row\s*\{[^}]*flex-wrap:\s*nowrap/s);
    assert.match(stripCss, /\.code-change-strip-row\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(stripCss, /\.code-change-strip\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(stripCss, /\.code-change-strip__label\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(stripCss, /\.code-change-strip__files\s*\{[^}]*white-space:\s*nowrap/s);
    assert.doesNotMatch(stripCss, /\+\s*38px/);
  });

  test('narrow dock hides the Code changes label instead of wrapping', () => {
    assert.match(
      stripCss,
      /@container chat-float-dock \(max-width: 440px\)\s*\{[^}]*\.code-change-strip__label\s*\{[^}]*display:\s*none/s,
    );
  });
});
