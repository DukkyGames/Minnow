/**
 * Models → Local Server — server state, what is loaded, the endpoints it
 * exposes, and the runtime log.
 */

import { subscribeServeLog, type ServeRecord } from '../../models/api-client';
import { classifyLogLine, toLogLines } from '../../models/serve-log';
import { setStatus } from '../status';
import {
  chip,
  copyField,
  copyText,
  el,
  emptyState,
  formatBytes,
  formatElapsed,
  icon,
  iconButton,
  textButton,
} from './dom';
import { showModelInInspector } from './inspector';
import {
  dismissLoad,
  getModelsState,
  refreshModels,
  runningServes,
  subscribeModelsStore,
  unloadServe,
  type LoadProgress,
} from './store';

/** OpenAI-compatible surface llama-server exposes. */
const ENDPOINTS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/v1/models', note: 'List loaded models' },
  { method: 'POST', path: '/v1/chat/completions', note: 'Chat, streaming or not' },
  { method: 'POST', path: '/v1/completions', note: 'Raw text completion' },
  { method: 'POST', path: '/v1/embeddings', note: 'Embeddings, when the model supports them' },
  { method: 'GET', path: '/health', note: 'Readiness probe' },
];

let bound = false;
let logSource: string | null = null;
let logUnsub: (() => void) | null = null;
let logBuffer = '';
let autoScroll = true;
let elapsedTimer: number | null = null;

function mount(): HTMLElement | null {
  return document.getElementById('modelsServerBody');
}

function isActive(): boolean {
  return Boolean(document.getElementById('modelsSection-server')?.classList.contains('is-active'));
}

/** Follow the log of whichever serve is selected in the log header. */
function bindLogStream(serveId: string | null): void {
  if (logSource === serveId && logUnsub) return;
  logUnsub?.();
  logUnsub = null;
  logBuffer = '';
  logSource = serveId;
  if (!serveId) {
    renderLogBody();
    return;
  }
  logUnsub = subscribeServeLog(serveId, (event) => {
    logBuffer = event.initial ? event.text : logBuffer + event.text;
    renderLogBody();
  });
}

function renderLogBody(): void {
  const body = document.getElementById('modelsLogBody');
  if (!body) return;
  const lines = toLogLines(logBuffer);
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    if (!line.trim()) continue;
    fragment.appendChild(el('div', `models-log-line models-log-line--${classifyLogLine(line)}`, line));
  }
  body.replaceChildren(fragment);
  if (autoScroll) body.scrollTop = body.scrollHeight;
}

function statusBar(serves: ServeRecord[]): HTMLElement {
  const running = serves.filter((s) => s.status === 'running');
  const starting = serves.filter((s) => s.status === 'starting');
  const isUp = running.length > 0;

  const bar = el('div', 'models-status-bar');

  const state = el('div', 'models-status-bar__state');
  const toggle = el('button', 'models-switch');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(isUp));
  toggle.setAttribute(
    'aria-label',
    isUp ? 'Stop the local server' : 'Load a model to start the local server',
  );
  toggle.appendChild(el('span', 'models-switch__thumb'));
  toggle.addEventListener('click', () => {
    if (isUp) {
      toggle.disabled = true;
      void Promise.all(running.map((s) => unloadServe(s.id)))
        .catch((err: unknown) => {
          setStatus('err', err instanceof Error ? err.message : 'Could not stop the server');
        })
        .finally(() => {
          toggle.disabled = false;
        });
      return;
    }
    void import('../models-page').then((m) => m.openModels('installed'));
  });

  const label = el(
    'span',
    'models-status-bar__label',
    isUp ? 'Running' : starting.length ? 'Starting' : 'Stopped',
  );
  label.prepend(
    el('span', `models-dot models-dot--${isUp ? 'running' : starting.length ? 'starting' : 'stopped'}`),
  );
  state.append(label, toggle);
  bar.appendChild(state);

  if (isUp) {
    const reach = el('div', 'models-status-bar__reach');
    reach.append(el('span', 'models-field-label', 'Reachable at'), copyField(running[0].baseUrl, 'Copy server URL'));
    bar.appendChild(reach);
  } else {
    bar.appendChild(
      el('p', 'models-status-bar__hint', 'No model is loaded, so nothing is listening yet.'),
    );
  }

  const loadBtn = textButton(
    'Load model',
    () => {
      void import('../models-page').then((m) => m.openModels('installed'));
    },
    'primary',
  );
  loadBtn.prepend(icon('plus-small'));
  bar.appendChild(loadBtn);
  return bar;
}

function loadingCard(load: LoadProgress, serve: ServeRecord | undefined): HTMLElement {
  const card = el('article', 'models-loaded is-loading');

  const head = el('div', 'models-loaded__head');
  const stateChip = el('span', 'models-loaded__state');
  if (load.error) {
    stateChip.classList.add('is-error');
    stateChip.textContent = 'Failed';
  } else {
    stateChip.textContent =
      load.percent != null ? `Loading ${load.percent.toFixed(2)}%` : 'Loading';
    stateChip.appendChild(el('span', 'models-spinner'));
  }
  head.appendChild(stateChip);
  head.appendChild(el('span', 'models-loaded__name', serve?.modelLabel ?? 'Model'));

  const actions = el('div', 'models-loaded__actions');
  if (load.error) {
    actions.appendChild(textButton('Dismiss', () => dismissLoad(load.serveId)));
  } else {
    actions.appendChild(
      textButton('Cancel', () => {
        void unloadServe(load.serveId).catch((err: unknown) => {
          setStatus('err', err instanceof Error ? err.message : 'Cancel failed');
        });
      }),
    );
  }
  head.appendChild(actions);
  card.appendChild(head);

  card.appendChild(
    el(
      'p',
      'models-loaded__meta',
      load.error ? load.error : `${load.phase} · ${formatElapsed(load.startedAt)}`,
    ),
  );

  if (!load.error) {
    const track = el('div', 'models-progress');
    const fill = el('div', 'models-progress__fill');
    if (load.percent != null) fill.style.width = `${Math.min(100, load.percent)}%`;
    else fill.classList.add('is-indeterminate');
    track.appendChild(fill);
    card.appendChild(track);
  }
  return card;
}

function loadedCard(serve: ServeRecord): HTMLElement {
  const card = el('article', 'models-loaded');

  const head = el('div', 'models-loaded__head');
  const stateChip = el('span', 'models-loaded__state is-ready', 'Ready');
  head.appendChild(stateChip);
  head.appendChild(el('span', 'models-loaded__name', serve.modelLabel));

  const actions = el('div', 'models-loaded__actions');
  actions.append(
    iconButton('copy', 'Copy model identifier', (): void => {
      void copyText(serve.modelLabel);
    }),
    iconButton('code-simple', 'Copy a cURL request', (): void => {
      const curl = [
        `curl ${serve.baseUrl}/v1/chat/completions \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{"model":"${serve.modelLabel}","messages":[{"role":"user","content":"Hello"}]}'`,
      ].join('\n');
      void copyText(curl).then((ok) => {
        if (ok) setStatus('ok', 'cURL request copied.');
      });
    }),
    textButton(
      'Eject',
      () => {
        void unloadServe(serve.id).catch((err: unknown) => {
          setStatus('err', err instanceof Error ? err.message : 'Eject failed');
        });
      },
      'danger',
    ),
  );
  head.appendChild(actions);
  card.appendChild(head);

  const meta = el('div', 'models-loaded__facts');
  meta.append(
    chip(serve.runtime),
    chip(`port ${serve.port}`),
    chip(`up ${formatElapsed(serve.startedAt)}`),
  );
  const settings = serve.llamaSettings as { ctx?: number; parallel?: number } | null;
  if (settings?.ctx) meta.appendChild(chip(`ctx ${settings.ctx}`));
  if (settings?.parallel) meta.appendChild(chip(`parallel ${settings.parallel}`));
  card.appendChild(meta);

  card.appendChild(copyField(serve.baseUrl, 'Copy base URL'));

  // Selecting the row wires the inspector to the matching library entry.
  const model = getModelsState().library.find((m) => m.path === serve.modelPath);
  if (model) {
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      showModelInInspector(model.id);
    });
    card.classList.add('is-selectable');
  }
  return card;
}

function endpointsBlock(baseUrl: string | null): HTMLElement {
  const block = el('section', 'models-block');
  const summary = el('details', 'models-endpoints');
  const head = el('summary', 'models-endpoints__summary');
  head.append(
    el('span', 'models-block__label', 'Supported endpoints'),
    el('span', 'models-endpoints__count', `${ENDPOINTS.length} routes`),
  );
  summary.appendChild(head);

  const list = el('div', 'models-endpoints__list');
  for (const endpoint of ENDPOINTS) {
    const row = el('div', 'models-endpoint');
    row.append(
      el('span', `models-endpoint__method models-endpoint__method--${endpoint.method.toLowerCase()}`, endpoint.method),
      el('span', 'models-endpoint__path', endpoint.path),
      el('span', 'models-endpoint__note', endpoint.note),
    );
    if (baseUrl) {
      row.appendChild(
        iconButton('copy', `Copy ${endpoint.path} URL`, () => {
          void copyText(`${baseUrl}${endpoint.path}`);
        }),
      );
    }
    list.appendChild(row);
  }
  summary.appendChild(list);
  block.appendChild(summary);
  return block;
}

function logsBlock(serves: ServeRecord[]): HTMLElement {
  const block = el('section', 'models-logs');

  const head = el('header', 'models-logs__head');
  head.appendChild(el('h3', 'models-block__label', 'Runtime log'));

  if (serves.length > 1) {
    const select = el('select', 'models-select') as HTMLSelectElement;
    select.setAttribute('aria-label', 'Log source');
    for (const serve of serves) {
      const option = el('option', undefined, serve.modelLabel) as HTMLOptionElement;
      option.value = serve.id;
      if (serve.id === logSource) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => bindLogStream(select.value));
    head.appendChild(select);
  }

  const controls = el('div', 'models-logs__controls');
  const scrollBtn = iconButton('angle-small-down', 'Follow new output', () => {
    autoScroll = !autoScroll;
    scrollBtn.classList.toggle('is-active', autoScroll);
    scrollBtn.setAttribute('aria-pressed', String(autoScroll));
    if (autoScroll) renderLogBody();
  });
  scrollBtn.classList.toggle('is-active', autoScroll);
  scrollBtn.setAttribute('aria-pressed', String(autoScroll));
  controls.append(
    iconButton('copy', 'Copy log', () => {
      void copyText(logBuffer);
    }),
    iconButton('broom', 'Clear view', () => {
      logBuffer = '';
      renderLogBody();
    }),
    scrollBtn,
  );
  head.appendChild(controls);
  block.appendChild(head);

  const body = el('pre', 'models-logs__body');
  body.id = 'modelsLogBody';
  body.setAttribute('role', 'log');
  body.setAttribute('aria-label', 'Runtime log output');
  block.appendChild(body);
  return block;
}

/** Redraw Local Server from store state. */
export function render(): void {
  const host = mount();
  if (!host) return;

  const state = getModelsState();
  const serves = runningServes();
  const running = serves.filter((s) => s.status === 'running');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(statusBar(serves));

  const loadedBlock = el('section', 'models-block');
  loadedBlock.appendChild(el('h3', 'models-block__label', 'Loaded models'));
  const list = el('div', 'models-loaded-list');

  for (const load of state.loads) {
    list.appendChild(loadingCard(load, state.serves.find((s) => s.id === load.serveId)));
  }
  for (const serve of running) {
    list.appendChild(loadedCard(serve));
  }

  if (!list.childElementCount) {
    list.appendChild(
      emptyState({
        glyph: 'microchip',
        title: 'Nothing loaded',
        body: 'Load a model from My Models and it will serve on a local OpenAI-compatible endpoint.',
        action: {
          label: 'Open My Models',
          onClick: () => {
            void import('../models-page').then((m) => m.openModels('installed'));
          },
        },
      }),
    );
  }
  loadedBlock.appendChild(list);
  fragment.appendChild(loadedBlock);

  fragment.appendChild(endpointsBlock(running[0]?.baseUrl ?? null));
  fragment.appendChild(logsBlock(serves));

  host.replaceChildren(fragment);

  const preferred = serves.find((s) => s.id === logSource) ?? serves[0];
  bindLogStream(preferred?.id ?? null);
  renderLogBody();
}

/** Mount Local Server (idempotent). */
export function mountServerSection(): void {
  if (!bound) {
    bound = true;
    subscribeModelsStore(() => {
      if (isActive()) render();
    });
  }
  render();
  void refreshModels();

  // "up 1m 04s" and load elapsed need a clock of their own.
  if (elapsedTimer != null) window.clearInterval(elapsedTimer);
  elapsedTimer = window.setInterval(() => {
    if (!isActive()) return;
    if (!runningServes().length && !getModelsState().loads.length) return;
    render();
  }, 5_000);
}

/** Stop streaming when the app closes. */
export function teardownServerSection(): void {
  logUnsub?.();
  logUnsub = null;
  logSource = null;
  if (elapsedTimer != null) window.clearInterval(elapsedTimer);
  elapsedTimer = null;
}
