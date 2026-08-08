/**
 * Post-process rendered cleanup plan markdown for scannable path + action rows.
 */

import { renderBrainMarkdown } from './wikilink-markdown';

/** Wiki-relative or workspace-scoped markdown paths in plan text. */
const PLAN_PATH_RE =
  /(?:workspaces\/[^\s`]+|(?:[\w.-]+\/)+[\w.-]+\.md)/g;

const ACTION_SPLIT_RE = /\s->\s/;

function wrapPathSegmentsInText(textNode: Text, pathClass: string): void {
  const text = textNode.data;
  if (!text || !PLAN_PATH_RE.test(text)) {
    PLAN_PATH_RE.lastIndex = 0;
    return;
  }
  PLAN_PATH_RE.lastIndex = 0;

  const parent = textNode.parentElement;
  if (!parent) return;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  PLAN_PATH_RE.lastIndex = 0;
  while ((match = PLAN_PATH_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      fragment.append(text.slice(lastIndex, match.index));
    }
    const span = document.createElement('span');
    span.className = pathClass;
    span.textContent = match[0];
    fragment.append(span);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    fragment.append(text.slice(lastIndex));
  }
  parent.replaceChild(fragment, textNode);
}

/** Walk text nodes only (NodeFilter.SHOW_TEXT = 4). */
const TREE_WALKER_SHOW_TEXT = 4;

/** Highlight file paths inside prose and action targets (skip code blocks and links). */
function highlightPlanPaths(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, TREE_WALKER_SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const parent = current.parentElement;
    if (!parent || parent.closest('code, pre, a')) continue;
    nodes.push(current as Text);
  }
  for (const node of nodes) {
    wrapPathSegmentsInText(node, 'brain-cleanup-path');
  }
}

/** Turn "path -> action" list lines into a two-column action row. */
function structureActionListItems(root: HTMLElement): void {
  const items = root.querySelectorAll('li');
  for (const li of items) {
    if (li.classList.contains('brain-cleanup-action-item')) continue;
    if (li.querySelector('ul, ol')) continue;

    const text = (li.textContent ?? '').trim();
    if (!ACTION_SPLIT_RE.test(text)) continue;

    const parts = text.split(ACTION_SPLIT_RE);
    const targetText = parts[0]?.trim() ?? '';
    const actionText = parts.slice(1).join(' -> ').trim();
    if (!targetText || !actionText) continue;

    li.classList.add('brain-cleanup-action-item');
    li.replaceChildren();

    const target = document.createElement('span');
    target.className = 'brain-cleanup-action-item__target';
    target.textContent = targetText;

    const verb = document.createElement('span');
    verb.className = 'brain-cleanup-action-item__verb';
    verb.textContent = actionText;

    li.append(target, verb);
  }
}

/** Apply path highlights after action rows so targets get mono styling. */
export function enhanceCleanupPlanMarkup(planRoot: HTMLElement): void {
  structureActionListItems(planRoot);
  highlightPlanPaths(planRoot);
}

/**
 * Render cleanup plan markdown and enhance list rows for review.
 */
export function renderCleanupPlanMarkdown(
  container: HTMLElement,
  markdown: string,
  onNavigate: (relPath: string) => void,
): void {
  container.replaceChildren();
  const planRoot = document.createElement('div');
  renderBrainMarkdown(planRoot, markdown, onNavigate);
  planRoot.classList.add('brain-cleanup-plan-markdown');
  enhanceCleanupPlanMarkup(planRoot);
  container.append(planRoot);
}
