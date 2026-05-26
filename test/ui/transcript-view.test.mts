/**
 * Benchmark / sub-agent transcript rendering (full message text + images).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import { MULTIMODAL_PROBE_PROMPT } from '../../src/benchmark/fixtures/multimodal-probe.ts';
import { renderTranscriptView } from '../../src/ui/transcript-view.ts';

function setupDom(): Window {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<div id="transcriptBody"></div>';
  return window;
}

describe('renderTranscriptView', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('shows full user string and assistant reply for speed-style probe', () => {
    setupDom();
    const body = document.getElementById('transcriptBody')!;
    const userPrompt =
      'Write exactly three short sentences about local LLM inference. No preamble.';
    const assistant =
      'Local LLMs run on your machine. They keep data private. Inference speed depends on hardware.';

    renderTranscriptView(body, [
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: assistant },
    ]);

    const userEl = body.querySelector('.transcript-view__user');
    const assistantEl = body.querySelector('.transcript-view__assistant');
    assert.equal(userEl?.textContent, userPrompt);
    assert.equal(assistantEl?.textContent, assistant);
  });

  test('shows assistant reasoning when content is empty', () => {
    setupDom();
    const body = document.getElementById('transcriptBody')!;
    renderTranscriptView(body, [
      { role: 'user', content: 'Count to three.' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'One, two, three.',
      },
    ]);

    assert.equal(
      body.querySelector('.transcript-view__assistant')?.textContent,
      'One, two, three.',
    );
    assert.equal(body.textContent?.includes('(empty assistant message)'), false);
  });

  test('shows full multimodal user prompt text, not a single token', () => {
    setupDom();
    const body = document.getElementById('transcriptBody')!;
    renderTranscriptView(body, [
      {
        role: 'user',
        content: [
          { type: 'text', text: MULTIMODAL_PROBE_PROMPT },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
      { role: 'assistant', content: 'A small silvery fish rests on wet wood.' },
    ]);

    const userText = body.querySelector('.transcript-view__user-text');
    assert.ok(userText);
    assert.equal(userText?.textContent, MULTIMODAL_PROBE_PROMPT);
    assert.ok(body.querySelector('.transcript-view__user-image'));
    assert.equal(
      body.querySelector('.transcript-view__assistant')?.textContent,
      'A small silvery fish rests on wet wood.',
    );
  });
});
