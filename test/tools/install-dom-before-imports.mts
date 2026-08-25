/**
 * Side-effect module: put a happy-dom `window` on globalThis before anything else.
 *
 * `dompurify` builds its sanitizer against `globalThis.window` at module eval, so a
 * suite that installs the DOM inside a test gets a DOMPurify with no `sanitize` —
 * every markdown render then throws. ESM evaluates imports in source order, so
 * importing this first makes the window exist by the time the renderer loads.
 */

import { Window } from 'happy-dom';

const window = new Window();
const g = globalThis as unknown as Record<string, unknown>;
g.window = window;
g.document = window.document;
g.HTMLElement = window.HTMLElement;
g.Node = window.Node;
g.Element = window.Element;
g.DocumentFragment = window.DocumentFragment;
