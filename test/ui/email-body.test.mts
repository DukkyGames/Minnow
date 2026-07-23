/**
 * Email reading-pane body renderer (HTML vs plain-text toggle).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Window } from 'happy-dom';

type EmailBodyModule = typeof import('../../src/ui/email/email-body.ts');

describe('email-body renderer', () => {
  let win: Window;
  let emailBody: EmailBodyModule;

  before(async () => {
    win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document as unknown as Document;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.Node = win.Node as unknown as typeof Node;
    emailBody = await import('../../src/ui/email/email-body.ts');
  });

  after(() => {
    win.close();
    delete (globalThis as { window?: unknown }).window;
  });

  test('emailBodySupportsViewToggle when both parts exist', () => {
    assert.equal(
      emailBody.emailBodySupportsViewToggle({
        bodyHtml: '<p>Hi</p>',
        bodyText: 'Hi',
      }),
      true,
    );
  });

  test('emailBodySupportsViewToggle when only plain text exists', () => {
    assert.equal(
      emailBody.emailBodySupportsViewToggle({
        bodyText: 'Hi',
      }),
      false,
    );
  });

  /** The srcdoc of the rendered body frame. */
  const frameDoc = (mount: HTMLElement): string =>
    mount.querySelector('iframe')?.getAttribute('srcdoc') ?? '';

  test('renders sanitized HTML into an isolated frame', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(mount, {
      bodyHtml: '<p>Hello <strong>team</strong></p>',
      bodyText: 'Hello team',
    });

    assert.equal(mount.classList.contains('html-body'), true);
    // Body content must never land in the app DOM, only inside the frame.
    assert.equal(mount.querySelectorAll('strong').length, 0);
    assert.match(frameDoc(mount), /<strong>team<\/strong>/);
  });

  test('frame is sandboxed without script execution', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(mount, { bodyHtml: '<p>Hi</p>' });

    const sandbox = mount.querySelector('iframe')?.getAttribute('sandbox') ?? '';
    // allow-same-origin is needed to measure height; combined with
    // allow-scripts it would let the frame out of the sandbox entirely.
    assert.match(sandbox, /allow-same-origin/);
    assert.doesNotMatch(sandbox, /allow-scripts/);
    assert.doesNotMatch(sandbox, /allow-top-navigation/);
  });

  test('frame CSP confines images to the local proxy', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(mount, { bodyHtml: '<p>Hi</p>' });

    const doc = frameDoc(mount);
    assert.match(doc, /default-src 'none'/);
    assert.match(doc, /img-src 'self' data: cid:/);
  });

  /*
   * The remote-content policy is exercised directly rather than through
   * renderEmailBody: DOMPurify under happy-dom discards <img> and <div>
   * outright (it keeps them in a real browser), so driving these cases through
   * the full render path would assert on an empty document and prove nothing.
   * Building the fragment here keeps the assertions about the policy itself.
   */
  const fragmentOf = (html: string): HTMLTemplateElement => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template;
  };

  test('withholds remote images and reports the count', () => {
    const template = fragmentOf(
      '<img src="https://tracker.example/a.gif"><img src="https://tracker.example/b.gif">',
    );
    const blocked = emailBody.applyRemoteContentPolicy(template.content, false);

    assert.equal(blocked, 2);
    // Nothing left that a renderer would dereference points at the sender.
    const live = template.innerHTML.replace(/data-minnow-remote-[a-z]+="[^"]*"/g, '');
    assert.doesNotMatch(live, /tracker\.example/);
  });

  test('blocks remote images still live in legacy cached bodies', () => {
    // Bodies cached before server-side parking landed still carry a live src.
    const template = fragmentOf('<img src="https://tracker.example/legacy.gif">');
    const blocked = emailBody.applyRemoteContentPolicy(template.content, false);

    assert.equal(blocked, 1);
    assert.match(
      template.innerHTML,
      /data-minnow-remote-src="https:\/\/tracker\.example\/legacy\.gif"/,
    );
  });

  test('routes images through the local proxy once loaded', () => {
    const template = fragmentOf('<img data-minnow-remote-src="https://tracker.example/a.gif">');
    emailBody.applyRemoteContentPolicy(template.content, true);

    const html = template.innerHTML;
    assert.match(html, /src="\/api\/email\/image-proxy\?url=/);
    // The direct URL must never be reachable from the frame, even when loading.
    assert.doesNotMatch(html, /src="https:\/\/tracker\.example/);
  });

  test('proxies every srcset candidate but keeps its descriptors', () => {
    const template = fragmentOf(
      '<img srcset="https://tracker.example/a.png 1x, https://tracker.example/b.png 2x">',
    );
    emailBody.applyRemoteContentPolicy(template.content, true);

    const html = template.innerHTML;
    assert.doesNotMatch(html, /srcset="https:\/\/tracker/);
    assert.match(html, /2x/);
  });

  test('strips remote url() from style attributes', () => {
    const template = fragmentOf(
      '<div style="background: url(https://tracker.example/x.png); color: red">hi</div>',
    );
    const blocked = emailBody.applyRemoteContentPolicy(template.content, false);

    assert.equal(blocked, 1);
    // The live style keeps `color` but loses the fetch; the original is parked
    // so "Load images" can restore it.
    const live = template.innerHTML.replace(/data-minnow-remote-[a-z]+="[^"]*"/g, '');
    assert.match(live, /color:\s*red/);
    assert.doesNotMatch(live, /url\(\s*['"]?https:\/\/tracker/);
    assert.match(template.innerHTML, /data-minnow-remote-style="[^"]*tracker\.example/);
  });

  test('leaves non-network cid: and data: sources alone', () => {
    const template = fragmentOf(
      '<img src="cid:logo@inline"><img src="data:image/gif;base64,R0lGOD">',
    );
    const blocked = emailBody.applyRemoteContentPolicy(template.content, false);

    assert.equal(blocked, 0);
    assert.match(template.innerHTML, /src="cid:logo@inline"/);
  });

  test('neutralises javascript: links and hardens the rest', () => {
    const template = fragmentOf(
      '<a href="javascript:alert(1)">x</a><a href="https://ok.example">y</a>',
    );
    emailBody.applyRemoteContentPolicy(template.content, false);

    const html = template.innerHTML;
    assert.doesNotMatch(html, /javascript:/i);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  test('plain mode shows only the text alternative', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(
      mount,
      {
        bodyHtml: '<p>Hello <strong>team</strong></p>',
        bodyText: 'Hello team',
      },
      { viewMode: 'plain' },
    );

    assert.equal(mount.classList.contains('html-body'), false);
    assert.equal(mount.textContent, 'Hello team');
    assert.equal(mount.innerHTML, 'Hello team');
  });

  test('matchTheme applies the dark smart-invert class in the frame document', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(mount, { bodyHtml: '<p>Hi</p>' }, { matchTheme: true });

    const frame = mount.querySelector('iframe');
    assert.equal(frame?.classList.contains('email-body-frame--dark'), true);
    assert.match(frameDoc(mount), /class="mn-dark"/);
  });

  test('falls back to plain text when HTML is missing', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(mount, {
      bodyText: 'Plain only',
    });

    assert.equal(mount.classList.contains('html-body'), false);
    assert.equal(mount.textContent, 'Plain only');
  });
});
