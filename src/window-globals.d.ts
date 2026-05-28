/**
 * Inline HTML handlers (`onclick`, `onchange`, etc.) call these on `window`.
 * Assigned in `main.ts` via `registerWindowHandlers()`.
 */
export {};

import type { ThemeId } from './theme';

declare global {
  interface Window {
    /** Dev-only: `initTheme` assigns `applyTheme` when `import.meta.env.DEV`. */
    __setTheme?: (id: ThemeId) => void;
    toggleSidebarLayout: () => void;
    createChat: () => void;
    fetchModels: () => Promise<void>;
    toggleSelectedModelLoad: () => Promise<void>;
    toggleDrawer: () => void;
    openSettingsFromTopbar: () => void;
    openBenchmarkFromTopbar: () => void;
    openExpertLabFromTopbar: () => void;
    openExpertLab?: () => void;
    closeDrawer: () => void;
    onDrawerKeydown: (e: KeyboardEvent) => void;
    clearChat: () => void;
    closeMobileSidebar: () => void;
    toggleSidebarCollapsed: () => void;
    sendMessage: () => Promise<void>;
    handleComposerPrimaryAction: () => void;
    toggleStatsPanel: () => void;
    onModelSelectChange: () => void;
    onSystemPromptPresetChange: () => void;
    onSystemPromptInput: () => void;
    handleKey: (e: KeyboardEvent) => void;
    autoResize: (el: HTMLTextAreaElement) => void;
    onFileSelected: (event: Event) => void;
    toggleFileSidebarLayout: () => void;
    toggleFileSidebarCollapsed: () => void;
    closeMobileFileSidebar: () => void;
    togglePreviewFromTopbar: () => void;
  }
}
