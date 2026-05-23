/**
 * Settings → Tools: per-agent overrides and auto-approve pattern list.
 */

import { BUILT_IN_TOOLS } from '../tools/definitions';
import {
  addApprovalPattern,
  getToolConfig,
  getToolPermissionForId,
  listKnownAgentKeys,
  removeApprovalPattern,
  saveToolConfig,
  setAgentToolPermission,
  type ToolPermissionMode,
} from '../tools/config';
import type { ApprovalPattern, ToolAgentKey } from '../tools/tool-settings-types';
import { setStatus } from './status';

const PERMISSION_OPTIONS: ToolPermissionMode[] = ['off', 'ask', 'full'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatAgentKeyLabel(key: ToolAgentKey): string {
  if (key === 'main') return 'Main chat';
  if (key === '*') return 'All agents (*)';
  if (key.startsWith('work-agent:')) return `Work agent · ${key.slice('work-agent:'.length)}`;
  if (key.startsWith('sub-agent:')) return `Sub-agent · ${key.slice('sub-agent:'.length)}`;
  return key;
}

/** Renders pattern list + add form and per-agent override rows under the tools settings mount. */
export function mountToolApprovalRulesSection(mount: HTMLElement): void {
  const section = el('section', 'settings-tool-approval-rules');
  const heading = el('h3', 'settings-subheading');
  heading.textContent = 'Auto-approve patterns';
  section.appendChild(heading);
  section.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Skip the approval strip when arguments match (global mode must be Ask). Does not bypass paths outside the workspace.',
    ),
  );

  const patternList = el('div', 'settings-approval-pattern-list');
  section.appendChild(patternList);

  const addForm = el('div', 'settings-approval-pattern-form field');
  const toolSelect = document.createElement('select');
  toolSelect.className = 'settings-approval-pattern-form__tool';
  toolSelect.appendChild(new Option('Select tool…', ''));
  for (const tool of BUILT_IN_TOOLS) {
    toolSelect.appendChild(new Option(tool.id, tool.id));
  }

  const agentSelect = document.createElement('select');
  agentSelect.className = 'settings-approval-pattern-form__agent';
  for (const key of listKnownAgentKeys()) {
    if (key === 'main') continue;
    agentSelect.appendChild(new Option(formatAgentKeyLabel(key), key));
  }
  agentSelect.appendChild(new Option('All agents (*)', '*'));

  const argPathInput = document.createElement('input');
  argPathInput.type = 'text';
  argPathInput.placeholder = 'Arg path (e.g. command)';
  argPathInput.className = 'settings-approval-pattern-form__path';

  const matchSelect = document.createElement('select');
  matchSelect.appendChild(new Option('starts with', 'startsWith'));
  matchSelect.appendChild(new Option('equals', 'equals'));

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.placeholder = 'Value';
  valueInput.className = 'settings-approval-pattern-form__value';

  const addBtn = el('button', 'settings-inline-btn', 'Add pattern');
  addBtn.type = 'button';

  addForm.append(toolSelect, agentSelect, argPathInput, matchSelect, valueInput, addBtn);
  section.appendChild(addForm);

  const overrideHeading = el('h3', 'settings-subheading');
  overrideHeading.textContent = 'Per-agent overrides';
  section.appendChild(overrideHeading);
  section.appendChild(
    el(
      'p',
      'settings-field-hint',
      'Override global permission for a specific agent. Off tools stay disabled everywhere.',
    ),
  );

  const overrideForm = el('div', 'settings-approval-override-form field');
  const overrideAgent = document.createElement('select');
  for (const key of listKnownAgentKeys()) {
    if (key === '*') continue;
    overrideAgent.appendChild(new Option(formatAgentKeyLabel(key), key));
  }
  const overrideTool = document.createElement('select');
  overrideTool.appendChild(new Option('Select tool…', ''));
  for (const tool of BUILT_IN_TOOLS) {
    overrideTool.appendChild(new Option(tool.id, tool.id));
  }
  const overrideMode = document.createElement('select');
  for (const mode of PERMISSION_OPTIONS) {
    overrideMode.appendChild(new Option(mode, mode));
  }
  const overrideBtn = el('button', 'settings-inline-btn', 'Save override');
  overrideBtn.type = 'button';
  overrideForm.append(overrideAgent, overrideTool, overrideMode, overrideBtn);
  section.appendChild(overrideForm);

  const overrideList = el('div', 'settings-approval-override-list');
  section.appendChild(overrideList);

  mount.appendChild(section);

  const refreshPatterns = (): void => {
    patternList.replaceChildren();
    const config = getToolConfig();
    if (config.permissions.patterns.length === 0) {
      patternList.appendChild(el('p', 'settings-field-hint', 'No patterns yet.'));
      return;
    }
    for (const pattern of config.permissions.patterns) {
      const row = el('div', 'settings-approval-pattern-row');
      row.textContent = `${pattern.toolId} · ${formatAgentKeyLabel(pattern.agentScope)} · ${pattern.argPath} ${pattern.match} "${pattern.value}"`;
      const del = el('button', 'settings-inline-btn', 'Remove');
      del.type = 'button';
      del.addEventListener('click', () => {
        removeApprovalPattern(config, pattern.id);
        saveToolConfig(config);
        setStatus('ok', 'Pattern removed');
        refreshPatterns();
      });
      row.appendChild(del);
      patternList.appendChild(row);
    }
  };

  const refreshOverrides = (): void => {
    overrideList.replaceChildren();
    const config = getToolConfig();
    const entries: { agentKey: ToolAgentKey; toolId: string; mode: ToolPermissionMode }[] = [];
    for (const [agentKey, tools] of Object.entries(config.permissions.perAgent)) {
      for (const [toolId, mode] of Object.entries(tools)) {
        entries.push({ agentKey, toolId, mode });
      }
    }
    if (entries.length === 0) {
      overrideList.appendChild(el('p', 'settings-field-hint', 'No per-agent overrides.'));
      return;
    }
    entries.sort((a, b) => a.agentKey.localeCompare(b.agentKey) || a.toolId.localeCompare(b.toolId));
    for (const entry of entries) {
      const globalMode = getToolPermissionForId(config, entry.toolId);
      const row = el('div', 'settings-approval-override-row');
      row.textContent = `${formatAgentKeyLabel(entry.agentKey)} · ${entry.toolId} → ${entry.mode} (global: ${globalMode})`;
      const del = el('button', 'settings-inline-btn', 'Remove');
      del.type = 'button';
      del.addEventListener('click', () => {
        const tools = config.permissions.perAgent[entry.agentKey];
        if (tools) delete tools[entry.toolId];
        saveToolConfig(config);
        setStatus('ok', 'Override removed');
        refreshOverrides();
      });
      row.appendChild(del);
      overrideList.appendChild(row);
    }
  };

  addBtn.addEventListener('click', () => {
    const toolId = toolSelect.value.trim();
    const agentScope = agentSelect.value as ToolAgentKey | '*';
    const argPath = argPathInput.value.trim();
    const match = matchSelect.value as ApprovalPattern['match'];
    const value = valueInput.value;
    if (!toolId || !argPath || !value.trim()) {
      setStatus('err', 'Tool, arg path, and value are required');
      return;
    }
    const config = getToolConfig();
    const pattern: ApprovalPattern = {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID ?
          crypto.randomUUID()
        : 'pattern-11111111-1111-1111-1111-111111111111',
      toolId,
      agentScope,
      argPath,
      match,
      value: value.trim(),
    };
    if (!addApprovalPattern(config, pattern)) {
      setStatus('err', 'Could not add pattern (duplicate or limit reached)');
      return;
    }
    saveToolConfig(config);
    setStatus('ok', 'Pattern added');
    argPathInput.value = '';
    valueInput.value = '';
    refreshPatterns();
  });

  overrideBtn.addEventListener('click', () => {
    const agentKey = overrideAgent.value as ToolAgentKey;
    const toolId = overrideTool.value.trim();
    const mode = overrideMode.value as ToolPermissionMode;
    if (!toolId) {
      setStatus('err', 'Select a tool for the override');
      return;
    }
    const config = getToolConfig();
    if (getToolPermissionForId(config, toolId) === 'off' && mode !== 'off') {
      setStatus('err', 'Enable the tool globally before granting per-agent access');
      return;
    }
    setAgentToolPermission(config, agentKey, toolId, mode);
    saveToolConfig(config);
    setStatus('ok', 'Per-agent override saved');
    refreshOverrides();
  });

  refreshPatterns();
  refreshOverrides();
}
