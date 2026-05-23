/**
 * Minnow Vite entry: styles, highlight.js theme, window handlers, init, service worker.
 */

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/motion.css';
import './styles/topbar.css';
import './styles/model-select.css';
import './styles/sidebar.css';
import './styles/messages.css';
import './styles/message-actions.css';
import './styles/thoughts.css';
import './styles/input.css';
import './styles/context-usage.css';
import './styles/settings.css';
import './styles/stats.css';
import './styles/agent-activity-panel.css';
import './styles/responsive.css';
import './styles/mode-selector.css';
import './styles/composer-controls.css';
import './styles/file-panel.css';
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
import './styles/view-mode-toggle.css';
import './styles/orchestrate-board.css';
import './styles/bug-board.css';

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
import { refreshSkillCatalog } from './skills/client';
import { loadSkillConfigFromStorage } from './skills/config';
import { mountSlashPicker } from './ui/skill-picker';
import { loadToolConfigFromStorage } from './tools/config';
import { loadToolSecurityMeta } from './config/tool-security-meta';
import { loadChatMeta } from './config/chat-meta';
import {
  getActiveChat,
  loadSessionsFromStorage,
  sessionState,
} from './state/sessions';
import { initChatScroll } from './ui/chat-scroll';
import { clearChat, renderChatFromHistory, renderStatsForChat } from './ui/messages';
import { bootGenerationResumeForChats } from './chat/generation-resume';
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
  loadProviderSelect,
  registerProviderHandlers,
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
import { initStatsStrip, toggleStatsPanel, updateStatsExpandPreview } from './ui/stats';
import {
  bindExpertsSettingsCheckbox,
  initExpertSelect,
} from './ui/expert-select';
import { initReefBridge } from './chat/reef/index.ts';
import {
  initOrchestratePlanSelector,
  syncOrchestratePlanStripFromActiveChat,
} from './ui/orchestrate-plan-selector';
import {
  initViewModeToggle,
  syncViewModeToggleFromActiveChat,
} from './ui/view-mode-toggle';
import { initModeSelector, syncModeSelectorFromActiveChat } from './ui/mode-selector';
import { syncReefWidgetSettingsFromActiveChat } from './ui/reef-widget-settings';
import { initWorkAgentDevUi, syncWorkAgentDevFromActiveChat } from './ui/work-agent-dev';
import { initSubAgentUi } from './ui/sub-agent-cards';
import { initAgentActivityPanel } from './ui/agent-activity-panel';
import {
  closeComposerToolsPopover,
  initComposerToolsPopover,
} from './ui/composer-tools-popover';
import { dismissOpenLayers } from './ui/status';
import {
  closeMobileFileSidebar,
  toggleFileSidebarCollapsed,
  toggleFileSidebarLayout,
} from './ui/file-layout';
import { initWorkspaceButton } from './ui/workspace-button';
import {
  initTerminalPanel,
  onTerminalServerAvailabilityChanged,
  refreshTerminalHistoryForActiveChat,
  registerTerminalKeyboardShortcut,
} from './ui/terminal-panel';
import { scheduleMarkAppReady } from './boot/app-ready';

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
  await runMigrationIfNeeded();
  // Load tools before any UI reads permissions (drawer + settings page rebuilds).
  await loadToolConfigFromStorage();
  await initPromptSystem();
  await initWorkAgentSystem();
  await loadSessionsFromStorage();
  const { loadBugsFromStorage, migrateBugsFromChats } = await import(
    './state/bug-board-store.ts'
  );
  await loadBugsFromStorage();
  if (sessionState) {
    await migrateBugsFromChats(sessionState.chats);
  }
  initSubAgentUi();
  initAgentActivityPanel();
  const { startSupervisor } = await import('./agents/supervisor');
  startSupervisor();
  fillSystemPromptPresetSelect();
  await loadSystemPromptSettings();
  fillToolsSection();
  fillToolsSection('composerToolsList', { variant: 'composer' });
  registerToolHandlers();
  initComposerToolsPopover();
  initAttachments();
  initContextUsageRing();
  initModeSelector();
  initOrchestratePlanSelector();
  initViewModeToggle();
  initReefBridge();
  initWorkAgentDevUi();
  await initExpertSelect();
  await bindExpertsSettingsCheckbox();
  await detectLocalServer();
  initWorkspaceButton();
  initModelSelectPicker();
  await refreshSkillCatalog();
  const msgInput = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (msgInput) {
    initComposerInput(msgInput);
    mountSlashPicker(msgInput);
  }
  initComposerDrop();
  const filePanel = await import('./ui/init-file-panel');
  await filePanel.initFilePanel();
  filePanel.onFilePanelServerAvailabilityChanged();
  await loadSkillConfigFromStorage();
  await loadToolSecurityMeta().catch(() => undefined);
  await loadChatMeta().catch(() => undefined);
  await initTerminalPanel();
  onTerminalServerAvailabilityChanged();
  initStatsStrip();
  initOrchestrateStatsLiveRefresh();
  initChatScroll();
  registerTerminalKeyboardShortcut();
  loadToolConfigIntoDrawer();
  applySidebarVisuals();
  renderSidebar();
  await refreshTerminalHistoryForActiveChat();
  await loadProviderSelect();
  registerProviderHandlers();
  const settingsPage = await import('./ui/settings-page');
  settingsPage.initSettingsPage();
  const benchmarkPage = await import('./ui/benchmark-page');
  benchmarkPage.initBenchmarkPage();
  const globalBugsPage = await import('./ui/global-bugs-page');
  globalBugsPage.initGlobalBugsPage();
  globalBugsPage.refreshGlobalBugsSidebarBadge();
  await fetchModels();
  syncModelSelectForActiveChat();
  updateModelLoadUnloadButtons();
  renderChatFromHistory(getActiveChat());
  if (sessionState) {
    void bootGenerationResumeForChats(sessionState.chats);
  }
  renderStatsForChat(getActiveChat());
  refreshContextUsageRing();
  syncModeSelectorFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncViewModeToggleFromActiveChat();
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
      closeComposerToolsPopover();
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
