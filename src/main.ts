/**
 * Minnow Vite entry: styles, highlight.js theme, window handlers, init, service worker.
 */

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/topbar.css';
import './styles/sidebar.css';
import './styles/messages.css';
import './styles/message-actions.css';
import './styles/thoughts.css';
import './styles/input.css';
import './styles/settings.css';
import './styles/stats.css';
import './styles/responsive.css';
import './styles/mode-selector.css';
import './styles/composer-controls.css';
import './styles/file-panel.css';
import './styles/terminal.css';
import './styles/skill-picker.css';
import './styles/composer-tools-popover.css';
import './styles/workspace-menu.css';
import './styles/settings-page.css';
import './styles/tool-approval.css';
import './styles/sub-agent-drawer.css';
import './styles/pending-turn-recovery.css';

import 'highlight.js/styles/github.min.css';

import { initAttachments, onFileSelected } from './attachments/store';
import { initComposerDrop } from './ui/composer-drop';
import {
  fetchModels,
  loadSelectedModel,
  unloadSelectedModel,
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
import { getActiveChat, loadSessionsFromStorage } from './state/sessions';
import { initChatScroll } from './ui/chat-scroll';
import { streaming } from './app-state';
import { flushPendingTurnNow } from './state/pending-turn';
import { clearChat, renderChatFromHistory, renderStatsForChat } from './ui/messages';
import { initPendingTurnRecoveryForChat } from './ui/pending-turn-recovery';
import { autoResize, handleComposerPrimaryAction, handleKey } from './ui/input';
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
import {
  initSettingsPage,
  openSettingsFromTopbar,
} from './ui/settings-page';
import { loadToolConfigIntoDrawer } from './tools/config';
import {
  createChat,
  onModelSelectChange,
  renderSidebar,
  syncModelSelectForActiveChat,
} from './ui/sidebar';
import { toggleStatsPanel, updateStatsExpandPreview } from './ui/stats';
import {
  bindExpertsSettingsCheckbox,
  initExpertSelect,
} from './ui/expert-select';
import { initModeSelector, syncModeSelectorFromActiveChat } from './ui/mode-selector';
import { initWorkAgentDevUi, syncWorkAgentDevFromActiveChat } from './ui/work-agent-dev';
import { initSubAgentUi } from './ui/sub-agent-cards';
import {
  closeComposerToolsPopover,
  initComposerToolsPopover,
} from './ui/composer-tools-popover';
import { dismissOpenLayers } from './ui/status';
import {
  initFilePanel,
  onFilePanelServerAvailabilityChanged,
  closeMobileFileSidebar,
  toggleFileSidebarCollapsed,
  toggleFileSidebarLayout,
} from './ui/init-file-panel';
import { initWorkspaceButton } from './ui/workspace-button';
import {
  initTerminalPanel,
  onTerminalServerAvailabilityChanged,
  refreshTerminalHistoryForActiveChat,
  registerTerminalKeyboardShortcut,
} from './ui/terminal-panel';

/** Expose inline HTML event handlers on `window` for the static markup. */
function registerWindowHandlers(): void {
  window.toggleSidebarLayout = toggleSidebarLayout;
  window.createChat = createChat;
  window.fetchModels = fetchModels;
  window.toggleDrawer = toggleDrawer;
  window.openSettingsFromTopbar = openSettingsFromTopbar;
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

/** Dismiss the inline loading shell (see index.html #app-loader). */
function markAppReady(): void {
  const loader = document.getElementById('app-loader');
  if (loader) {
    loader.setAttribute('aria-busy', 'false');
    loader.setAttribute('aria-hidden', 'true');
  }
  document.documentElement.classList.add('app-ready');
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
  initSubAgentUi();
  fillSystemPromptPresetSelect();
  await loadSystemPromptSettings();
  fillToolsSection();
  fillToolsSection('composerToolsList', { variant: 'composer' });
  registerToolHandlers();
  initComposerToolsPopover();
  initAttachments();
  initModeSelector();
  initWorkAgentDevUi();
  await initExpertSelect();
  await bindExpertsSettingsCheckbox();
  await detectLocalServer();
  initWorkspaceButton();
  await refreshSkillCatalog();
  const msgInput = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (msgInput) mountSlashPicker(msgInput);
  initComposerDrop();
  await initFilePanel();
  onFilePanelServerAvailabilityChanged();
  onTerminalServerAvailabilityChanged();
  await loadSkillConfigFromStorage();
  await loadToolSecurityMeta().catch(() => undefined);
  await initTerminalPanel();
  initChatScroll();
  registerTerminalKeyboardShortcut();
  loadToolConfigIntoDrawer();
  applySidebarVisuals();
  renderSidebar();
  await refreshTerminalHistoryForActiveChat();
  await loadProviderSelect();
  registerProviderHandlers();
  initSettingsPage();
  await fetchModels();
  syncModelSelectForActiveChat();
  updateModelLoadUnloadButtons();
  renderChatFromHistory(getActiveChat());
  initPendingTurnRecoveryForChat(getActiveChat());
  renderStatsForChat(getActiveChat());
  syncModeSelectorFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  renderSidebar();

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
      dismissOpenLayers();
    }
  });

  const flushOnExit = (): void => {
    if (streaming) flushPendingTurnNow();
  };
  window.addEventListener('pagehide', flushOnExit);
  window.addEventListener('beforeunload', flushOnExit);

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

// Vite has injected CSS by now; hide the inline loader before async boot work.
markAppReady();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}
