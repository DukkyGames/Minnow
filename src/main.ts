/**
 * Minnow Vite entry: styles, highlight.js theme, shell handlers, init, service worker.
 */

import './styles/fonts.css';
import './styles/font-presets.css';
import './styles/tokens.css';
import './styles/theme-transitions.css';
import './styles/global.css';
import './styles/motion.css';
import './styles/topbar.css';
import './styles/model-select.css';
import './styles/sidebar.css';
import './styles/chat-search.css';
import './styles/messages.css';
import './styles/message-actions.css';
import './styles/voice.css';
import './styles/branch-picker.css';
import './styles/thoughts.css';
import './styles/code-change-strip.css';
import './styles/tool-call-diff.css';
import './styles/input.css';
import './styles/code-ref-link.css';
import './styles/context-usage.css';
import './styles/settings.css';
import './styles/settings-evals.css';
import './styles/stats.css';
import './styles/agent-activity-panel.css';
import './styles/responsive.css';
import './styles/mode-selector.css';
import './styles/mode-icons.css';
import './styles/composer-controls.css';
import './styles/composer-message-queue.css';
import './styles/file-panel.css';
import './styles/git-commit-diff.css';
import './styles/editor-quick-edit.css';
import './styles/editor-intent-mode.css';
import './styles/preview-panel.css';
import './styles/design-mode.css';
import './styles/terminal.css';
import './styles/skill-picker.css';
import './styles/composer-tools-popover.css';
import './styles/workspace-menu.css';
import './styles/workspace-folder-picker.css';
import './styles/git-center-lightbox.css';
import './styles/git-help-lightbox.css';
import './styles/tool-approval.css';
import './styles/question-cards.css';
import './styles/reef-widgets.css';
import './styles/sub-agent-drawer.css';
import './styles/orchestrate-plan-selector.css';
import './styles/composer-pinned-skill.css';
import './styles/composer-model-trigger.css';
import './styles/view-mode-toggle.css';
import './styles/orchestrate-board.css';
import './styles/toast.css';
import './styles/bug-board.css';
import './styles/hub.css';
import './styles/code-overview.css';
import './styles/orchestrate-hub.css';
import './styles/orchestrate-plan-screen.css';
import './styles/plan-progress.css';
import './styles/minnowos-shell.css';
import './styles/minnowos-desktop.css';
import './styles/desktop-workspace-rail.css';
import './styles/minnowos-wallpaper.css';
import './styles/minnowos-apps.css';
import './styles/chat-app.css';
import './styles/models-page.css';
import './styles/onboarding.css';

import 'highlight.js/styles/github.min.css';

import { installFetchAuth } from './api/install-fetch-auth';
import { initTheme } from './ui/theme';
import { initAttachments } from './attachments/store';
import { initShellHandlers } from './ui/shell-handlers';
import { installScopedSelectAllHandler } from './ui/scoped-select-all';
import { initComposerDrop } from './ui/composer-drop';
import { initContextUsageRing, refreshContextUsageRing } from './ui/context-usage-ring';
import { closeContextUsageBreakdown } from './ui/context-usage-breakdown';
import {
  fetchModels,
  toggleSelectedModelLoad,
  updateModelLoadUnloadButtons,
} from './api/models';
import { initWorkAgentSystem } from './agents/init-work-agents';
import { initPromptSystem } from './chat/prompts/init-prompts';
import { detectConfigServer, isServerStorageMode, refreshConfigStorageBanner } from './config/storage-mode';
import { runMigrationIfNeeded } from './config/migrate';
import { detectLocalServer } from './tools/client';
import { startSchedulerNotificationPoll } from './scheduler/notifications-poll';
import { initNotificationProducers } from './notifications/producers';
import { refreshSkillCatalog } from './skills/client';
import { loadSkillConfigFromStorage } from './skills/config';
import { initAllComposerSlashPickers } from './ui/skill-picker';
import { loadToolConfigFromStorage } from './tools/config';
import { loadToolSecurityMeta } from './config/tool-security-meta';
import { loadBrowserMeta } from './config/browser-meta';
import { loadChatMeta } from './config/chat-meta';
import { applySamplerMetaToDrawer, loadSamplerMeta } from './config/sampler-meta';
import { loadAutopilotMeta } from './config/autopilot-meta';
import {
  getActiveChat,
  loadSessionsFromStorage,
  registerSessionPersistenceShutdownHandler,
  sessionState,
} from './state/sessions';
import { initChatScroll } from './ui/chat-scroll';
import { initMinnowBrowserLinkRouting } from './ui/minnow-browser-links';
import { renderChatFromHistory, renderStatsForChat } from './ui/messages';
import { refreshHubLiveData } from './ui/hub';
import { bootGenerationResumeForChats } from './chat/generation-resume';
import { bootIncompleteToolResumeForChats } from './chat/incomplete-tool-resume';
import {
  bindAskQuestionPlanScreenHooks,
  notifyAskQuestionDisplayContextChanged,
} from './chat/ask-question-display';
import {
  isOrchestratePlanScreenSuppressingChatDom,
  resolveOrchestratePlanScreenQuestionHost,
} from './ui/orchestrate-plan-screen';
import {
  isBoardOnboardingSuppressingChatDom,
  resolveBoardOnboardingQuestionHost,
} from './ui/orchestrate-board-onboarding-questions';
import { subscribeInstances } from './os/instances';
import { bootOrchestrateBoardResume } from './chat/orchestrate/board-boot-resume';
import { initBoardLogDiskSink } from './state/board-log-disk.ts';
import { registerOrchestrateBoardShutdownHandler } from './chat/orchestrate/board-shutdown';
import { rehydrateAllBoardWorktreeRoots } from './state/orchestrate-board-actions';
import { initComposerInput } from './ui/input';
import {
  applySidebarVisuals,
  closeMobileSidebar,
  isMobileLayout,
} from './ui/layout';
import { initAppSidebarResizers } from './ui/sidebar-resize';
import {
  fillSystemPromptPresetSelect,
  fillToolsSection,
  loadSystemPromptSettings,
  registerToolHandlers,
} from './ui/settings';
import { loadToolConfigIntoDrawer } from './tools/config';
import {
  initModelSelectPicker,
  syncModelSelectPicker,
} from './ui/model-select-picker';
import {
  initComposerModelTriggers,
  syncComposerModelTriggers,
} from './ui/composer-model-trigger';
import {
  renderSidebar,
  syncModelSelectForActiveChat,
} from './ui/sidebar';
import { bootstrapActiveChatOpenedTimestamp } from './ui/chat-item-dot';
import { initStatsStrip, updateStatsExpandPreview } from './ui/stats';
import { bindExpertsSettingsCheckbox } from './ui/experts-settings';
import { syncComposerPinnedSkillFromActiveChat } from './ui/composer-pinned-skill';
import { syncGoalActiveHint } from './ui/goal-active-hint';
import { syncTodoPanel } from './ui/todo-panel';
import {
  initOrchestratePlanSelector,
  syncOrchestratePlanStripFromActiveChat,
} from './ui/orchestrate-plan-selector';
import {
  initViewModeToggle,
  syncViewModeToggleFromActiveChat,
} from './ui/view-mode-toggle';
import { initModeSelector, syncModeSelectorFromActiveChat } from './ui/mode-selector';
import { initModeChromeIcons } from './ui/mode-icons';
import { initThinkingControl } from './ui/composer-thinking';
import {
  initComposerReasoningEffort,
  syncComposerReasoningEffortFromActiveChat,
} from './ui/composer-reasoning-effort';
import { loadThinkingMeta } from './config/thinking-meta';
import { syncReefWidgetSettingsFromActiveChat } from './ui/reef-widget-settings';
import { initWorkAgentDevUi, syncWorkAgentDevFromActiveChat } from './ui/work-agent-dev';
import { initSubAgentUi } from './ui/sub-agent-cards';
import { initGoalEvalUi } from './ui/goal-eval-status';
import { initAgentActivityPanel } from './ui/agent-activity-panel';
import {
  closeComposerToolsPopover,
  closeAllToolsPopovers,
  initChatAppToolsPopover,
  initComposerToolsPopover,
} from './ui/composer-tools-popover';
import { initComposerVoice } from './ui/composer-voice';
import { initVoiceStatus } from './ui/voice-controls';
import { dismissOpenLayers } from './ui/status';
import { clearMobileFileSidebarOverlay, closeMobileFileSidebar } from './ui/file-layout';
import { initWorkspaceButton, refreshWorkspaceUi } from './ui/workspace-button';
import {
  initWelcomePage,
  markWelcomePendingIfNeeded,
  onWelcomeServerAvailabilityChanged,
  openWelcome,
  shouldShowWelcomeOnBoot,
} from './ui/welcome-page';
import { getWorkspacePath } from './state/workspace.ts';
import { bindWorkspacePathForToolCache } from './tools/result-cache.ts';
import { scheduleMarkAppReady } from './boot/app-ready';
import { installRendererDiagnostics } from './boot/diagnostics';
import { initNotificationAudioUnlock } from './notifications/sound';
import { initOsPageBridge, isOsShellEnabled } from './os/page-bridge';
import { initOsRouter } from './os/router';
import { initOsShell } from './os/shell';

/** Register PWA service worker (shell cache); failures are ignored. */
function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/** Boot app: sessions, settings, sidebar, models, first paint. */
export async function initApp(): Promise<void> {
  bindAskQuestionPlanScreenHooks({
    resolveQuestionHost: (chatId) =>
      resolveOrchestratePlanScreenQuestionHost(chatId) ??
      resolveBoardOnboardingQuestionHost(chatId),
    isSuppressingChatDom: (chatId) =>
      isOrchestratePlanScreenSuppressingChatDom(chatId) ||
      isBoardOnboardingSuppressingChatDom(chatId),
  });
  subscribeInstances(() => {
    notifyAskQuestionDisplayContextChanged();
  });
  await detectConfigServer();
  refreshConfigStorageBanner();
  initBoardLogDiskSink();
  await runMigrationIfNeeded();
  // Load tools before any UI reads permissions (drawer + settings page rebuilds).
  await loadToolConfigFromStorage();
  await initPromptSystem();
  await initWorkAgentSystem();
  await loadSessionsFromStorage(isServerStorageMode() ? { force: true } : undefined);
  registerOrchestrateBoardShutdownHandler();
  registerSessionPersistenceShutdownHandler();
  const { loadBugsFromStorage, migrateBugsFromChats } = await import(
    './state/bug-board-store.ts'
  );
  await loadBugsFromStorage();
  if (sessionState) {
    await migrateBugsFromChats(sessionState.chats);
  }
  initSubAgentUi();
  initGoalEvalUi();
  initAgentActivityPanel();
  fillSystemPromptPresetSelect();
  await loadSystemPromptSettings();
  fillToolsSection();
  fillToolsSection('composerToolsList', { variant: 'composer' });
  fillToolsSection('chatAppToolsList', { variant: 'composer' });
  registerToolHandlers();
  initComposerToolsPopover();
  initChatAppToolsPopover();
  initComposerVoice();
  void initVoiceStatus();
  initAttachments();
  initContextUsageRing();
  initModeSelector();
  initModeChromeIcons();
  initThinkingControl();
  initComposerReasoningEffort();
  initOrchestratePlanSelector();
  const { initComposerRunTarget } = await import('./ui/composer-run-target');
  initComposerRunTarget();
  initViewModeToggle();
  initWorkAgentDevUi();
  await bindExpertsSettingsCheckbox();
  await detectLocalServer();
  const { shouldShowOnboardingOnBoot, mountOnboarding } = await import('./onboarding');
  const showOnboarding = await shouldShowOnboardingOnBoot();
  if (showOnboarding) {
    await mountOnboarding();
  }
  startSchedulerNotificationPoll();
  initNotificationProducers();
  onWelcomeServerAvailabilityChanged();
  const { notifyCodeWorkspaceServerAvailability } = await import(
    './boot/code-workspace-modules'
  );
  await notifyCodeWorkspaceServerAvailability();
  bindWorkspacePathForToolCache(getWorkspacePath);
  initWorkspaceButton();
  await refreshWorkspaceUi();
  markWelcomePendingIfNeeded();
  initWelcomePage();
  if (shouldShowWelcomeOnBoot()) {
    openWelcome();
  } else {
    document.documentElement.classList.remove('welcome-pending');
  }
  initModelSelectPicker();
  initComposerModelTriggers();
  await refreshSkillCatalog();
  const msgInput = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (msgInput) {
    initComposerInput(msgInput);
  }
  initAllComposerSlashPickers();
  initComposerDrop();
  const { ensureCodeWorkspaceModulesForBoot } = await import('./boot/code-workspace-modules');
  await ensureCodeWorkspaceModulesForBoot();
  initAppSidebarResizers();
  await loadSkillConfigFromStorage();
  await loadToolSecurityMeta().catch(() => undefined);
  await loadBrowserMeta().catch(() => undefined);
  await loadChatMeta().catch(() => undefined);
  await loadSamplerMeta()
    .then(applySamplerMetaToDrawer)
    .catch(() => undefined);
  await loadAutopilotMeta().catch(() => undefined);
  await loadThinkingMeta().catch(() => undefined);
  initStatsStrip();
  initChatScroll();
  initMinnowBrowserLinkRouting();
  loadToolConfigIntoDrawer();
  applySidebarVisuals();
  renderSidebar();
  const { wireSidebarNewGroupButton } = await import('./ui/sidebar');
  wireSidebarNewGroupButton();
  const { refreshTerminalHistoryForActiveChat } = await import('./ui/terminal-panel');
  await refreshTerminalHistoryForActiveChat();
  const { ensureBootAppsInitialized } = await import('./os/app-modules');
  await ensureBootAppsInitialized();
  const globalBugsPage = await import('./ui/global-bugs-page');
  globalBugsPage.initGlobalBugsPage();
  globalBugsPage.refreshGlobalBugsSidebarBadge();
  await fetchModels();
  syncModelSelectForActiveChat();
  syncModelSelectPicker();
  syncComposerModelTriggers();
  updateModelLoadUnloadButtons();
  renderChatFromHistory(getActiveChat());
  const { applyComposerDraftForChat } = await import('./ui/composer-draft');
  applyComposerDraftForChat(getActiveChat());
  if (sessionState) {
    await rehydrateAllBoardWorktreeRoots(sessionState);
    await bootGenerationResumeForChats(sessionState.chats);
    await bootIncompleteToolResumeForChats(sessionState.chats);
    await bootOrchestrateBoardResume(sessionState);
  }
  renderStatsForChat(getActiveChat());
  refreshContextUsageRing();
  syncModeSelectorFromActiveChat();
  syncComposerReasoningEffortFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncComposerPinnedSkillFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncGoalActiveHint();
  syncTodoPanel();
  renderSidebar();
  bootstrapActiveChatOpenedTimestamp();

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      closeMobileSidebar();
      clearMobileFileSidebarOverlay();
    }
    applySidebarVisuals();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllToolsPopovers();
      closeContextUsageBreakdown();
      dismissOpenLayers();
    }
  });

  const drawerOverlay = document.getElementById('drawerOverlay');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const fileSidebarBackdrop = document.getElementById('fileSidebarBackdrop');
  if (drawerOverlay) drawerOverlay.tabIndex = -1;
  if (sidebarBackdrop) sidebarBackdrop.tabIndex = -1;
  if (fileSidebarBackdrop) fileSidebarBackdrop.tabIndex = -1;
  updateStatsExpandPreview();
}

/** Start init once the document is ready (module scripts often run after `load`). */
async function startApp(): Promise<void> {
  initShellHandlers();
  installScopedSelectAllHandler();
  if (isOsShellEnabled()) {
    const hash = window.location.hash;
    if (hash === '' || hash === '#' || hash === '#/') {
      window.location.replace('#/desktop');
    }
    initOsPageBridge();
    initOsShell();
  }
  installRendererDiagnostics();
  initNotificationAudioUnlock();
  // Sessions must load before OS routing — Code app mount calls getActiveChat().
  await detectConfigServer();
  await loadSessionsFromStorage();
  // Probe the tool server before routing — Code boot initializes the file tree during
  // initOsRouter() and reads this flag (MIN-436).
  await detectLocalServer();
  if (isOsShellEnabled()) {
    initOsRouter();
  }
  void initApp();
}

installFetchAuth();

registerServiceWorker();

initTheme();

// Keep the inline loader until bundled CSS is applied (avoids unstyled shell FOUC).
scheduleMarkAppReady();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
