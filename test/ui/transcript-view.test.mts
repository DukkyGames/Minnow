/**
 * Benchmark / sub-agent transcript rendering (full message text + images).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import { MULTIMODAL_PROBE_PROMPT } from '../../src/benchmark/fixtures/multimodal-probe.ts';
import { renderTranscriptView } from '../../src/ui/transcript-view.ts';
import { subAgentTranscriptLiveFromRun } from '../../src/ui/sub-agent-live-status.ts';

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

  test('shows collapsible reasoning when prose and reasoning both exist', () => {
    setupDom();
    const body = document.getElementById('transcriptBody')!;
    renderTranscriptView(body, [
      { role: 'user', content: 'Solve the bat-and-ball puzzle.' },
      {
        role: 'assistant',
        content: 'The ball costs $0.05.',
        reasoning_content: '1.10 - 1.00 = 0.10',
      },
    ]);

    assert.equal(
      body.querySelector('.transcript-view__assistant')?.textContent,
      'The ball costs $0.05.',
    );
    assert.equal(
      body.querySelector('.transcript-view__thinking-body')?.textContent,
      '1.10 - 1.00 = 0.10',
    );
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

  test('appends live thinking and tool indicators for in-flight sub-agent turns', () => {
    setupDom();
    const body = document.getElementById('transcriptBody')!;

    renderTranscriptView(
      body,
      [
        { role: 'user', content: 'Explore src/' },
        { role: 'assistant', content: 'Scanning the tree…' },
      ],
      {
        isLive: true,
        phase: 'tools',
        currentToolName: 'list_directory',
      },
    );

    assert.ok(body.querySelector('.transcript-view__live-tail'));
    assert.ok(body.querySelector('.tool-start-indicator'));
    assert.match(
      body.querySelector('.tool-start-indicator__label')?.textContent ?? '',
      /List Directory/i,
    );

    body.replaceChildren();
    renderTranscriptView(body, [{ role: 'user', content: 'Go' }], {
      isLive: true,
      phase: 'thinking',
      partialReasoning: 'Need to check package.json first.',
    });

    assert.ok(body.querySelector('.stream-status--thinking'));
    assert.ok(body.querySelector('.transcript-view__thinking-body'));
  });

  test('subAgentTranscriptLiveFromRun maps orchestrator live fields', () => {
    const live = subAgentTranscriptLiveFromRun(
      {
        runId: 'run-1',
        type: 'explore',
        task: 't',
        status: 'running',
        parentChatId: 'chat-1',
        parentToolCallId: null,
        parentTurnId: null,
        summary: '',
        error: null,
        startedAt: null,
        endedAt: null,
        toolTurns: 0,
        cancelled: false,
        messages: [],
        livePhase: 'generating',
      },
      true,
    );
    assert.equal(live?.phase, 'generating');
    assert.equal(live?.isLive, true);
  });

  test('generating live tail paints partial prose so the row is not empty', () => {
    setupDom();
    const body = document.getElementById('transcriptBody')!;
    renderTranscriptView(body, [{ role: 'user', content: 'Explore src/' }], {
      isLive: true,
      phase: 'generating',
      partialText: 'Here is what I found in src/.',
    });
    assert.ok(body.querySelector('.stream-status--generating'));
    assert.match(body.textContent ?? '', /Generating response/);
    const partial = body.querySelector('.transcript-view__assistant--partial');
    assert.ok(partial);
    assert.equal(partial?.textContent, 'Here is what I found in src/.');
  });
});
