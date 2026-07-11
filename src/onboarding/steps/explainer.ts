/**
 * S10 — Visual workspace tour with interactive hotspots.
 */

import { el, renderStepHeader } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep, OnboardingStepActions } from '../types';
import { recordStepProgress } from '../state-core';

interface WorkspaceNode {
  id: string;
  label: string;
  x: number;
  y: number;
  blurb: string;
  tools?: string[];
}

const WORKSPACE_NODES: WorkspaceNode[] = [
  {
    id: 'chat',
    label: 'Chat',
    x: 50,
    y: 48,
    blurb: 'Where you talk to models. Modes change behavior: Build edits code, Plan stays read-only, Debug tracks bugs.',
    tools: ['send messages', 'slash skills', 'tool calls inline'],
  },
  {
    id: 'brain',
    label: 'Brain',
    x: 18,
    y: 28,
    blurb: 'Your local wiki. Minnow reads it before answering and files new facts after tool runs.',
    tools: ['memory_save', 'brain pages'],
  },
  {
    id: 'research',
    label: 'Research',
    x: 82,
    y: 24,
    blurb: 'A sub-agent searches the web, reads sources, and writes a cited report.',
    tools: ['web_search', 'fetch_url'],
  },
  {
    id: 'code',
    label: 'Code',
    x: 22,
    y: 72,
    blurb: 'Full workspace: files, git, terminal, LSP, and dev server in one app.',
    tools: ['read_file', 'save_file', 'execute_command'],
  },
  {
    id: 'experts',
    label: 'Experts',
    x: 78,
    y: 68,
    blurb: 'Purpose-built agent personas you compose, run, and compare.',
    tools: ['spawn_subagent'],
  },
  {
    id: 'tools',
    label: 'Tools',
    x: 50,
    y: 82,
    blurb: 'About 88 built-in tools plus MCP. Permissions control what runs without asking.',
    tools: ['/commands', 'ask_question', 'browser_*'],
  },
];

let activeNodeId = 'chat';
let visited = new Set<string>(['chat']);

function renderMap(
  mapHost: HTMLElement,
  detailHost: HTMLElement,
  actions: OnboardingStepActions,
): void {
  mapHost.replaceChildren();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mn-onboarding-map');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Minnow workspace map');

  const hub = WORKSPACE_NODES.find((n) => n.id === 'chat');
  if (hub) {
    for (const node of WORKSPACE_NODES) {
      if (node.id === 'chat') continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(hub.x));
      line.setAttribute('y1', String(hub.y));
      line.setAttribute('x2', String(node.x));
      line.setAttribute('y2', String(node.y));
      line.setAttribute('class', 'mn-onboarding-map__link');
      svg.appendChild(line);
    }
  }

  for (const node of WORKSPACE_NODES) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `mn-onboarding-map__node${activeNodeId === node.id ? ' is-active' : ''}${visited.has(node.id) ? ' is-visited' : ''}`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', node.label);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(node.x));
    circle.setAttribute('cy', String(node.y));
    circle.setAttribute('r', node.id === 'chat' ? '9' : '7');
    g.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(node.x));
    text.setAttribute('y', String(node.y + (node.id === 'chat' ? 16 : 14)));
    text.setAttribute('text-anchor', 'middle');
    text.textContent = node.label;
    g.appendChild(text);

    const activate = () => {
      activeNodeId = node.id;
      visited.add(node.id);
      renderMap(mapHost, detailHost, actions);
    };
    g.addEventListener('click', activate);
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        activate();
      }
    });
    svg.appendChild(g);
  }

  mapHost.appendChild(svg);

  const active = WORKSPACE_NODES.find((n) => n.id === activeNodeId) ?? WORKSPACE_NODES[0];
  detailHost.replaceChildren();
  detailHost.appendChild(el('h3', 'mn-onboarding-subtitle', active.label));
  detailHost.appendChild(el('p', 'mn-onboarding-explainer-body', active.blurb));
  if (active.tools?.length) {
    const toolList = el('ul', 'mn-onboarding-tool-list');
    active.tools.forEach((tool) => {
      const li = el('li', null, tool);
      toolList.appendChild(li);
    });
    detailHost.appendChild(toolList);
  }

  const progress = el(
    'p',
    'mn-onboarding-muted',
    `Explored ${visited.size} of ${WORKSPACE_NODES.length} areas`,
  );
  detailHost.appendChild(progress);

  const allVisited = visited.size >= WORKSPACE_NODES.length;
  actions.setPrimaryLabel(allVisited ? 'Continue' : 'Next area');
  actions.setPrimaryEnabled(true);
}

export const explainerStep: OnboardingStep = {
  id: 'explainer',
  title: 'How Minnow works',
  canSkip: true,
  isApplicable: () => true,

  render(container, _ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--explainer';

    renderStepHeader(container, explainerStep, actions.stepIndex, actions.totalSteps);
    container.appendChild(
      el(
        'p',
        'mn-onboarding-step-desc',
        'Tap each area on the map. The next screen lets you try tools in a guided chat.',
      ),
    );

    const layout = el('div', 'mn-onboarding-explainer-layout');
    const mapHost = el('div', 'mn-onboarding-map-host');
    const detailHost = el('div', 'mn-onboarding-explainer-card');
    layout.append(mapHost, detailHost);
    container.appendChild(layout);

    renderMap(mapHost, detailHost, actions);
  },

  commit(ctx) {
    ctx.state = recordStepProgress(ctx.state, 'explainer', {
      done: true,
      data: { visited: [...visited] },
    });
    activeNodeId = 'chat';
    visited = new Set(['chat']);
  },
};

/** Advance explainer to the next unvisited node. Returns true when advanced. */
export function advanceExplainerPanel(): boolean {
  const order = WORKSPACE_NODES.map((n) => n.id);
  const next = order.find((id) => !visited.has(id));
  if (!next) return false;
  activeNodeId = next;
  visited.add(next);
  return true;
}

export function resetExplainerState(): void {
  activeNodeId = 'chat';
  visited = new Set(['chat']);
}
