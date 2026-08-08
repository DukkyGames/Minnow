/**
 * Super Plan top-bar entry.
 *
 * Super Plan used to be reachable only through a caret tucked inside the Plan
 * segment of the composer mode strip — a menu hidden in a radio button, which
 * told you nothing about the full-column surface behind it. It is a destination
 * in the Code view bar now, beside Orchestrate and Dev servers, and behaves like
 * they do: press to open, press again to leave.
 *
 * What the Code view-bar button opens depends on what is already going:
 *
 *   1. the run the planning session is already pointing at,
 *   2. otherwise the newest pipeline still in flight (a 20-minute run must never
 *      be hidden behind a blank composer),
 *   3. otherwise a new plan, with the library rail listing everything saved.
 *
 * Orchestrate hub **Make a plan** always wants a blank composer (`preferNew`),
 * so it does not resume the last session or jump into a live run.
 */

import '../styles/super-plan-page.css';

import { collectSuperPlanRuns, isChatInCurrentWorkspace } from '../chat/super-plan/plan-library';
import { normalizeModeId } from '../chat/modes/types';
import { findChatById, sessionState } from '../state/sessions';
import type { Chat } from '../types';
import {
  derivePlanScreenPhaseFromSuperPlan,
  getOrchestratePlanScreenSession,
  isSuperPlanPipelineResumable,
  renderOrchestratePlanScreen,
  teardownOrchestratePlanScreen,
  type OrchestratePlanScreenPhase,
} from './orchestrate-plan-screen';
import { isSuperPlanPageMounted } from './super-plan-page';
import { syncSuperPlanChrome } from './super-plan-chrome';
import { createChatWithMode, switchChat } from './sidebar';

let returnChatId: string | null = null;
let initialized = false;

/** True when the Super Plan surface owns the stage. */
export function isSuperPlanScreenOpen(): boolean {
  return isSuperPlanPageMounted();
}

function isSuperPlanChat(chat: Chat | null | undefined): boolean {
  return Boolean(chat && normalizeModeId(chat.modeId) === 'super-plan');
}

/** Every other full-column Code view stands down before the surface mounts. */
async function closeCompetingMainColumnViews(): Promise<void> {
  const orchestrate = await import('./orchestrate-hub');
  if (orchestrate.isOrchestrateHubMounted()) orchestrate.teardownOrchestrateHub();
  const overview = await import('./code-overview');
  if (overview.isCodeOverviewOpen()) {
    overview.closeCodeOverview({ skipNavigate: true, restoreChat: false });
  }
  const devServers = await import('./dev-server-screen');
  if (devServers.isDevServerScreenOpen()) {
    devServers.closeDevServerScreen({ skipNavigate: true, restoreChat: false });
  }
  const brain = await import('./code-brain-map');
  if (brain.isCodeBrainMapOpen()) brain.closeCodeBrainMap();
  const { teardownIssuesEmbedBeforeChatPaint } = await import('./issues-page');
  teardownIssuesEmbedBeforeChatPaint();
  const { teardownHub } = await import('./hub');
  teardownHub();
}

/** Newest super-plan chat whose pipeline has not finished. */
function findLiveSuperPlanChat(): Chat | null {
  const live = collectSuperPlanRuns()
    .filter((run) => run.state !== 'done' && run.state !== 'saved')
    .sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0));
  for (const run of live) {
    const chat = run.chatId ? findChatById(run.chatId) : null;
    if (chat && isSuperPlanPipelineResumable(chat)) return chat;
  }
  return null;
}

/** An empty super-plan chat is a spare composer; reuse it before making another. */
function resolveOrCreateComposeChat(): Chat | null {
  const spare = sessionState?.chats.find(
    (c) =>
      isSuperPlanChat(c) &&
      isChatInCurrentWorkspace(c) &&
      c.history.length === 0 &&
      !c.superPlan,
  );
  if (spare) return spare;

  const created = createChatWithMode({ modeId: 'super-plan' });
  if (!created.ok || !created.chatId) return null;
  return findChatById(created.chatId) ?? null;
}

interface SuperPlanTarget {
  chat: Chat;
  phase: OrchestratePlanScreenPhase;
}

/** Options for {@link openSuperPlanScreen}. */
export interface OpenSuperPlanScreenOptions {
  /**
   * Skip resuming the last planning session or an in-flight run and open a
   * blank Super Plan composer (reuse an empty spare chat when one exists).
   * Used by Orchestrate hub **Make a plan**.
   */
  preferNew?: boolean;
}

function resolveSuperPlanTarget(options?: OpenSuperPlanScreenOptions): SuperPlanTarget | null {
  if (!sessionState) return null;

  // Explicit "new plan" entry points must not restore the previous surface.
  if (!options?.preferNew) {
    const session = getOrchestratePlanScreenSession();
    const sessionChat = session ? findChatById(session.chatId) : null;
    if (isSuperPlanChat(sessionChat) && isChatInCurrentWorkspace(sessionChat!)) {
      return {
        chat: sessionChat!,
        phase: sessionChat!.superPlan
          ? derivePlanScreenPhaseFromSuperPlan(sessionChat!)
          : 'prompt',
      };
    }

    const live = findLiveSuperPlanChat();
    if (live) return { chat: live, phase: derivePlanScreenPhaseFromSuperPlan(live) };
  }

  const compose = resolveOrCreateComposeChat();
  return compose ? { chat: compose, phase: 'prompt' } : null;
}

/** Mount the Super Plan surface, remembering where to come back to. */
export async function openSuperPlanScreen(options?: OpenSuperPlanScreenOptions): Promise<void> {
  // Resume path: if the surface is already up, leave it alone.
  // preferNew remounts onto a blank composer even when a prior plan is showing.
  if (isSuperPlanScreenOpen() && !options?.preferNew) return;

  await closeCompetingMainColumnViews();

  const activeChat = sessionState?.activeId ? findChatById(sessionState.activeId) : null;
  if (!returnChatId && activeChat && !isSuperPlanChat(activeChat)) {
    returnChatId = activeChat.id;
  }

  const target = resolveSuperPlanTarget(options);
  if (!target) return;

  // Drop any suspended / prior plan-screen session so paint cannot revive it.
  if (options?.preferNew) {
    teardownOrchestratePlanScreen();
  }

  if (sessionState && sessionState.activeId !== target.chat.id) {
    await switchChat(target.chat.id);
  }

  renderOrchestratePlanScreen({
    phase: target.phase,
    chatId: target.chat.id,
    savedPrompt: target.chat.superPlan?.prompt,
  });
}

/**
 * Leave Super Plan for a real conversation. The chat behind a run is never a
 * valid landing place — it is the pipeline's transport, not something to read —
 * so a super-plan return target is skipped in favour of the newest chat that
 * isn't one.
 */
function resolveReturnChat(): Chat | null {
  const remembered = returnChatId ? findChatById(returnChatId) : null;
  if (remembered && !isSuperPlanChat(remembered)) return remembered;

  const active = sessionState?.activeId ? findChatById(sessionState.activeId) : null;
  if (active && !isSuperPlanChat(active)) return active;

  return sessionState?.chats.find((c) => !isSuperPlanChat(c)) ?? null;
}

/** Close the surface and restore the chat that was foreground when it opened. */
export async function closeSuperPlanScreen(): Promise<void> {
  if (!isSuperPlanScreenOpen()) return;

  const target = resolveReturnChat();
  teardownOrchestratePlanScreen();
  returnChatId = null;

  if (!target) {
    document.getElementById('chatArea')?.replaceChildren();
    syncSuperPlanChrome(false);
    return;
  }

  if (sessionState && sessionState.activeId !== target.id) {
    await switchChat(target.id);
    return;
  }
  const { renderChatFromHistory } = await import('./messages');
  renderChatFromHistory(target);
}

/** View-bar toggle: press to open, press again to leave. */
export async function toggleSuperPlanScreenFromTopbar(): Promise<void> {
  if (isSuperPlanScreenOpen()) {
    await closeSuperPlanScreen();
    return;
  }
  await openSuperPlanScreen();
}

/** Wire the view-bar button (idempotent). */
export function initSuperPlanEntry(): void {
  if (initialized) return;
  initialized = true;

  document.getElementById('btnSuperPlan')?.addEventListener('click', () => {
    void toggleSuperPlanScreenFromTopbar();
  });
  syncSuperPlanChrome(isSuperPlanScreenOpen());
}

/** Clear entry state between tests. */
export function resetSuperPlanEntryForTests(): void {
  returnChatId = null;
  initialized = false;
  syncSuperPlanChrome(false);
}
