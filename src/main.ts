/**
 * Minnow Vite entry: styles, highlight.js theme, window handlers, init, service worker.
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
import './styles/file-panel.css';
import './styles/editor-quick-edit.css';
import './styles/editor-intent-mode.css';
import './styles/preview-panel.css';
import './styles/terminal.css';
import './styles/skill-picker.css';
import './styles/composer-tools-popover.css';
import './styles/workspace-menu.css';
import './styles/workspace-folder-picker.css';
import './styles/tool-approval.css';
import './styles/question-cards.css';
import './styles/reef-widgets.css';
import './styles/sub-agent-drawer.css';
import './styles/orchestrate-plan-selector.css';
import './styles/composer-pinned-skill.css';
import './styles/view-mode-toggle.css';
import './styles/orchestrate-board.css';
import './styles/toast.css';
import './styles/bug-board.css';
import './styles/hub.css';
import './styles/code-overview.css';
import './styles/orchestrate-hub.css';
import './styles/orchestrate-plan-screen.css';
import './styles/minnowos-shell.css';
import './styles/minnowos-desktop.css';
import './styles/minnowos-wallpaper.css';
import './styles/minnowos-apps.css';
import './styles/chat-app.css';
import './styles/models-page.css';

import 'highlight.js/styles/github.min.css';

import { initTheme } from './ui/theme';
import { initAttachments, onFileSelected } from './attachments/store';
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
import { sendMessage } from './chat/messaging';
import { detectConfigServer, refreshConfigStorageBanner } from './config/storage-mode';
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
  sessionState,
} from './state/sessions';
import { initChatScroll } from './ui/chat-scroll';
import { clearChat, renderChatFromHistory, renderStatsForChat } from './ui/messages';
import { refreshHubLiveData } from './ui/hub';
import { bootGenerationResumeForChats } from './chat/generation-resume';
import { bootIncompleteToolResumeForChats } from './chat/incomplete-tool-resume';
import { bootOrchestrateBoardResume } from './chat/orchestrate/board-boot-resume';
import { initBoardLogDiskSink } from './state/board-log-disk.ts';
import { registerOrchestrateBoardShutdownHandler } from './chat/orchestrate/board-shutdown';
import { rehydrateAllBoardWorktreeRoots } from './state/orchestrate-board-actions';
import {
  autoResize,
  handleComposerPrimaryAction,
  handleKey,
  initComposerInput,
} from './ui/input';
import {
  applySidebarVisuals,
  closeMobileSidebar,
  isMobileLayout,
  toggleSidebarCollapsed,
  toggleSidebarLayout,
} from './ui/layout';
import {
  closeDrawer,
  fillSystemPromptPresetSelect,
  fillToolsSection,
  loadSystemPromptSettings,
  onDrawerKeydown,
  onSystemPromptInput,
  onSystemPromptPresetChange,
  registerToolHandlers,
  toggleDrawer,
} from './ui/settings';
import { loadToolConfigIntoDrawer } from './tools/config';
import {
  initModelSelectPicker,
  syncModelSelectPicker,
} from './ui/model-select-picker';
import {
  createChat,
  onModelSelectChange,
  renderSidebar,
  syncModelSelectForActiveChat,
} from './ui/sidebar';
import { bootstrapActiveChatOpenedTimestamp } from './ui/chat-item-dot';
import { initOrchestrateStatsLiveRefresh } from './chat/orchestrate/stats-live';
import { initCodeChangeStrip } from './ui/code-change-strip';
import { initStatsStrip, toggleStatsPanel, updateStatsExpandPreview } from './ui/stats';
import { bindExpertsSettingsCheckbox } from './ui/experts-settings';
import { initReefBridge } from './chat/reef/index.ts';
import { syncComposerPinnedSkillFromActiveChat } from './ui/composer-pinned-skill';
import { syncGoalActiveHint } from './ui/goal-active-hint';
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
import {
  initOrchestrateHub,
  toggleOrchestrateHubFromTopbar,
} from './ui/orchestrate-hub';
import { initThinkingControl } from './ui/composer-thinking';
import {
  initComposerReasoningEffort,
  syncComposerReasoningEffortFromActiveChat,
} from './ui/composer-reasoning-effort';
import { loadThinkingMeta } from './config/thinking-meta';
import { syncReefWidgetSettingsFromActiveChat } from './ui/reef-widget-settings';
import { initWorkAgentDevUi, syncWorkAgentDevFromActiveChat } from './ui/work-agent-dev';
import { initSubAgentUi } from './ui/sub-agent-cards';
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
import {
  closeMobileFileSidebar,
  toggleFileSidebarCollapsed,
  toggleFileSidebarLayout,
} from './ui/file-layout';
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
import {
  initTerminalPanel,
  onTerminalServerAvailabilityChanged,
  refreshTerminalHistoryForActiveChat,
  registerTerminalKeyboardShortcut,
} from './ui/terminal-panel';
import { scheduleMarkAppReady } from './boot/app-ready';
import { installRendererDiagnostics } from './boot/diagnostics';
import { initOsPageBridge, isOsShellEnabled } from './os/page-bridge';
import { initOsRouter } from './os/router';
import { initOsShell } from './os/shell';

/** Expose inline HTML event handlers on `window` for the static markup. */
function registerWindowHandlers(): void {
  window.toggleSidebarLayout = toggleSidebarLayout;
  window.createChat = createChat;
  window.fetchModels = fetchModels;
  window.toggleSelectedModelLoad = toggleSelectedModelLoad;
  window.toggleDrawer = toggleDrawer;
  window.openSettingsFromTopbar = () => {
    void import('./ui/settings-page').then((m) => m.openSettingsFromTopbar());
  };
  window.openBenchmarkFromTopbar = () => {
    void import('./ui/benchmark-page').then((m) => m.openBenchmarkFromTopbar());
  };
  window.openModelsFromTopbar = () => {
    void import('./ui/models-page').then((m) => m.openModelsFromTopbar());
  };
  window.openBrainFromTopbar = () => {
    void import('./ui/brain-page').then((m) => m.openBrainFromTopbar());
  };
  window.openCompareFromTopbar = () => {
    void import('./ui/compare-page').then((m) => m.openCompareFromTopbar());
  };
  window.openResearchFromTopbar = () => {
    void import('./research/panel').then((m) => m.openResearchFromTopbar());
  };
  window.openExpertLabFromTopbar = () => {
    void import('./ui/experts/experts-hub').then((m) => m.openExpertLabFromTopbar());
  };
  window.closeDrawer = closeDrawer;
  window.onDrawerKeydown = onDrawerKeydown;
  window.clearChat = clearChat;
  window.closeMobileSidebar = closeMobileSidebar;
  window.toggleSidebarCollapsed = toggleSidebarCollapsed;
  window.sendMessage = sendMessage;
  window.handleComposerPrimaryAction = handleComposerPrimaryAction;
  window.toggleStatsPanel = toggleStatsPanel;
  window.onModelSelectChange = onModelSelectChange;
  window.onSystemPromptPresetChange = onSystemPromptPresetChange;
  window.onSystemPromptInput = onSystemPromptInput;
  window.handleKey = handleKey;
  window.autoResize = autoResize;
  window.onFileSelected = onFileSelected;
  window.toggleFileSidebarLayout = toggleFileSidebarLayout;
  window.toggleFileSidebarCollapsed = toggleFileSidebarCollapsed;
  window.closeMobileFileSidebar = closeMobileFileSidebar;
  window.togglePreviewFromTopbar = () => {
    void import('./ui/preview-panel').then((m) => m.togglePreviewPanel());
  };
  window.toggleOrchestrateHubFromTopbar = toggleOrchestrateHubFromTopbar;
}

/** Register PWA service worker (shell cache); failures are ignored. */
function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/** Boot app: sessions, settings, sidebar, models, first paint. */
export async function initApp(): Promise<void> {
  await detectConfigServer();
  refreshConfigStorageBanner();
  initBoardLogDiskSink();
  await runMigrationIfNeeded();
  // Load tools before any UI reads permissions (drawer + settings page rebuilds).
  await loadToolConfigFromStorage();
  await initPromptSystem();
  await initWorkAgentSystem();
  await loadSessionsFromStorage();
  registerOrchestrateBoardShutdownHandler();
  const { loadBugsFromStorage, migrateBugsFromChats } = await import(
    './state/bug-board-store.ts'
  );
  await loadBugsFromStorage();
  if (sessionState) {
    await migrateBugsFromChats(sessionState.chats);
  }
  initSubAgentUi();
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
  initOrchestrateHub();
  const { initCodeBrainMap } = await import('./ui/code-brain-map');
  initCodeBrainMap();
  const { initCodeOverview } = await import('./ui/code-overview');
  initCodeOverview();
  initThinkingControl();
  initComposerReasoningEffort();
  initOrchestratePlanSelector();
  initViewModeToggle();
  initReefBridge();
  initWorkAgentDevUi();
  await bindExpertsSettingsCheckbox();
  await detectLocalServer();
  startSchedulerNotificationPoll();
  initNotificationProducers();
  onWelcomeServerAvailabilityChanged();
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
  await refreshSkillCatalog();
  const msgInput = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (msgInput) {
    initComposerInput(msgInput);
  }
  initAllComposerSlashPickers();
  initComposerDrop();
  const filePanel = await import('./ui/init-file-panel');
  await filePanel.initFilePanel();
  filePanel.onFilePanelServerAvailabilityChanged();
  await loadSkillConfigFromStorage();
  await loadToolSecurityMeta().catch(() => undefined);
  await loadBrowserMeta().catch(() => undefined);
  await loadChatMeta().catch(() => undefined);
  await loadSamplerMeta()
    .then(applySamplerMetaToDrawer)
    .catch(() => undefined);
  await loadAutopilotMeta().catch(() => undefined);
  await loadThinkingMeta().catch(() => undefined);
  await initTerminalPanel();
  onTerminalServerAvailabilityChanged();
  const { initShellRunUi } = await import('./ui/shell-run-ui');
  initShellRunUi();
  initStatsStrip();
  initCodeChangeStrip();
  initOrchestrateStatsLiveRefresh();
  initChatScroll();
  registerTerminalKeyboardShortcut();
  loadToolConfigIntoDrawer();
  applySidebarVisuals();
  renderSidebar();
  const { wireSidebarNewGroupButton } = await import('./ui/sidebar');
  wireSidebarNewGroupButton();
  await refreshTerminalHistoryForActiveChat();
  const settingsPage = await import('./ui/settings-page');
  settingsPage.initSettingsPage();
  const benchmarkPage = await import('./ui/benchmark-page');
  benchmarkPage.initBenchmarkPage();
  const modelsPage = await import('./ui/models-page');
  modelsPage.initModelsPage();
  const brainPage = await import('./ui/brain-page');
  brainPage.initBrainPage();
  const comparePage = await import('./ui/compare-page');
  comparePage.initComparePage();
  const schedulerPage = await import('./ui/scheduler-page');
  schedulerPage.initSchedulerPage();
  const calendarPage = await import('./ui/calendar-page');
  calendarPage.initCalendarPage();
  const emailPage = await import('./ui/email-page');
  emailPage.initEmailPage();
  const researchPage = await import('./research/panel');
  researchPage.initResearchPage();
  const chatApp = await import('./ui/chat-app');
  chatApp.initChatApp();
  const globalBugsPage = await import('./ui/global-bugs-page');
  globalBugsPage.initGlobalBugsPage();
  const expertsHub = await import('./ui/experts/experts-hub');
  expertsHub.initExpertsHub();
  globalBugsPage.refreshGlobalBugsSidebarBadge();
  await fetchModels();
  syncModelSelectForActiveChat();
  updateModelLoadUnloadButtons();
  renderChatFromHistory(getActiveChat());
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
  renderSidebar();
  bootstrapActiveChatOpenedTimestamp();

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      closeMobileSidebar();
      closeMobileFileSidebar();
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
function startApp(): void {
  if (isOsShellEnabled()) {
    const hash = window.location.hash;
    if (hash === '' || hash === '#' || hash === '#/') {
      window.location.replace('#/desktop');
    }
    initOsPageBridge();
    initOsShell();
    initOsRouter();
  }
  installRendererDiagnostics();
  void initApp();
}

registerWindowHandlers();
registerServiceWorker();

initTheme();

// Keep the inline loader until bundled CSS is applied (avoids unstyled shell FOUC).
scheduleMarkAppReady();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
