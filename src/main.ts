/**
 * SpeedChat Vite entry: styles, highlight.js theme, window handlers, init, service worker.
 */

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/topbar.css';
import './styles/sidebar.css';
import './styles/messages.css';
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
import './styles/settings-page.css';

import 'highlight.js/styles/github.min.css';

import { initAttachments, onFileSelected } from './attachments/store';
import { fetchModels } from './api/models';
import { initWorkAgentSystem } from './agents/init-work-agents';
import { initPromptSystem } from './chat/prompts/init-prompts';
import { sendMessage } from './chat/messaging';
import { detectConfigServer, refreshConfigStorageBanner } from './config/storage-mode';
import { runMigrationIfNeeded } from './config/migrate';
import { detectLocalServer } from './tools/client';
import { refreshSkillCatalog } from './skills/client';
import { mountSlashPicker } from './ui/skill-picker';
import { loadToolConfigFromStorage } from './tools/config';
import { getActiveChat, loadSessionsFromStorage } from './state/sessions';
import { clearChat, renderChatFromHistory, renderStatsForChat } from './ui/messages';
import { autoResize, handleKey } from './ui/input';
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
import { dismissOpenLayers } from './ui/status';
import {
  initFilePanel,
  closeMobileFileSidebar,
  toggleFileSidebarCollapsed,
  toggleFileSidebarLayout,
} from './ui/init-file-panel';
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
  await initPromptSystem();
  await initWorkAgentSystem();
  await loadSessionsFromStorage();
  fillSystemPromptPresetSelect();
  await loadSystemPromptSettings();
  fillToolsSection();
  registerToolHandlers();
  initAttachments();
  initModeSelector();
  initWorkAgentDevUi();
  await initExpertSelect();
  await bindExpertsSettingsCheckbox();
  await detectLocalServer();
  await refreshSkillCatalog();
  const msgInput = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (msgInput) mountSlashPicker(msgInput);
  await initFilePanel();
  onTerminalServerAvailabilityChanged();
  await loadToolConfigFromStorage();
  await initTerminalPanel();
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
  renderChatFromHistory(getActiveChat());
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
    if (e.key === 'Escape') dismissOpenLayers();
  });

  const drawerOverlay = document.getElementById('drawerOverlay');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const fileSidebarBackdrop = document.getElementById('fileSidebarBackdrop');
  if (drawerOverlay) drawerOverlay.tabIndex = -1;
  if (sidebarBackdrop) sidebarBackdrop.tabIndex = -1;
  if (fileSidebarBackdrop) fileSidebarBackdrop.tabIndex = -1;
  updateStatsExpandPreview();
}

registerWindowHandlers();
registerServiceWorker();

window.addEventListener('load', () => {
  void initApp();
});
