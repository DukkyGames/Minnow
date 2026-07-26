/**
 * Renderer coordinator for tray commands and live agent/model status sync.
 */

import { listActiveSubAgentRuns } from './agents/orchestrator';
import { subscribeSubAgentRuns } from './agents/sub-agent-events';
import {
  listMainTurnActivity,
  subscribeMainTurnActivity,
} from './chat/main-turn-activity';
import {
  listTitleJobActivity,
  subscribeTitleJobActivity,
} from './chat/titles/activity-events';
import { listTitleJobInflightChatIds } from './chat/titles/inflight';
import { getTitleScheduleContext } from './chat/titles/schedule';
import { buildAgentActivitySnapshot } from './state/agent-activity-registry';
import { sessionState } from './state/sessions';
import { getTrayApi } from './electron/tray-client';
import type { MinnowTrayRendererCommand } from './electron.d.ts';
import {
  buildTrayStatusSnapshot,
  collectLocalModelTrayRows,
  unloadAllLocalModels,
} from './local-models/tray-status';
import { appConfirm } from './ui/app-dialog';
import { setStatus } from './ui/status';

const STATUS_THROTTLE_MS = 400;

let initialized = false;
let unsubscribeCommand: (() => void) | null = null;
let statusTimer: ReturnType<typeof setTimeout> | null = null;
const commandQueue: MinnowTrayRendererCommand[] = [];
let appReady = false;

function countRunningAgents(): number {
  if (!sessionState) return 0;
  const titleJobs = listTitleJobActivity();
  const seen = new Set(titleJobs.map((j) => j.chatId));
  for (const chatId of listTitleJobInflightChatIds()) {
    if (seen.has(chatId)) continue;
    titleJobs.push({
      chatId,
      modelId: getTitleScheduleContext(chatId)?.modelId,
      providerId: getTitleScheduleContext(chatId)?.providerId,
      startedAtMs: Date.now(),
    });
  }
  return buildAgentActivitySnapshot({
    nowMs: Date.now(),
    chats: sessionState.chats,
    mainTurns: listMainTurnActivity(),
    subAgents: listActiveSubAgentRuns(),
    titleJobs,
  }).length;
}

async function publishTrayStatusNow(): Promise<void> {
  const tray = getTrayApi();
  if (!tray) return;
  const loadedLocalModels = await collectLocalModelTrayRows();
  const snapshot = buildTrayStatusSnapshot(countRunningAgents(), loadedLocalModels);
  await tray.publishStatus(snapshot);
}

export function notifyElectronTrayStatusChanged(): void {
  if (!initialized) return;
  scheduleTrayStatusPublish();
}

function scheduleTrayStatusPublish(): void {
  if (statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    void publishTrayStatusNow();
  }, STATUS_THROTTLE_MS);
}

async function handleUnloadLocalModels(): Promise<void> {
  const agentCount = countRunningAgents();
  if (agentCount > 0) {
    const proceed = await appConfirm(
      'Agents are still running and may be using a loaded model. Unload all local models anyway?',
      { title: 'Unload local models' },
    );
    if (!proceed) return;
  }

  setStatus('spin', 'Unloading local models…');
  const result = await unloadAllLocalModels();
  await publishTrayStatusNow();

  if (result.errors.length === 0) {
    setStatus('ok', result.unloaded > 0 ? 'Local models unloaded' : 'No local models were loaded');
    return;
  }
  const detail = result.errors.slice(0, 3).join('; ');
  const suffix = result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : '';
  setStatus(
    'err',
    result.unloaded > 0
      ? `Unloaded ${result.unloaded}; some failed: ${detail}${suffix}`
      : `Unload failed: ${detail}${suffix}`,
  );
}

async function dispatchTrayCommand(command: MinnowTrayRendererCommand): Promise<void> {
  switch (command) {
    case 'new_chat': {
      const { createNewDesktopChat } = await import('./ui/desktop-chat-rail');
      await createNewDesktopChat();
      break;
    }
    case 'open_settings': {
      const { launchApp } = await import('./os/router');
      launchApp('settings', {
        settingsSection: 'general',
        settingsSearchKey: 'general.desktop',
      });
      break;
    }
    case 'unload_local_models':
      await handleUnloadLocalModels();
      break;
    default:
      break;
  }
}

async function flushCommandQueue(): Promise<void> {
  if (!appReady) return;
  while (commandQueue.length > 0) {
    const command = commandQueue.shift();
    if (!command) continue;
    await dispatchTrayCommand(command);
  }
}

function enqueueTrayCommand(command: MinnowTrayRendererCommand): void {
  commandQueue.push(command);
  void flushCommandQueue();
}

function wireTraySubscriptions(): void {
  subscribeMainTurnActivity(() => scheduleTrayStatusPublish());
  subscribeSubAgentRuns(() => scheduleTrayStatusPublish());
  subscribeTitleJobActivity(() => scheduleTrayStatusPublish());
  window.addEventListener('focus', () => {
    void publishTrayStatusNow();
  });
}

/** Initialize tray bridge after session/UI hydration. Safe to call once. */
export function initElectronTrayBridge(): void {
  if (initialized) return;
  const tray = getTrayApi();
  if (!tray) return;
  initialized = true;

  unsubscribeCommand = tray.onCommand((command) => {
    enqueueTrayCommand(command);
  });

  wireTraySubscriptions();
  void publishTrayStatusNow();
}

/** Call when initApp finishes so early tray commands can run. */
export function markElectronTrayBridgeAppReady(): void {
  appReady = true;
  void flushCommandQueue();
  void publishTrayStatusNow();
}

/** Tear down listeners (tests). */
export function disposeElectronTrayBridge(): void {
  unsubscribeCommand?.();
  unsubscribeCommand = null;
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  commandQueue.length = 0;
  initialized = false;
  appReady = false;
}
