/**
 * Inline HTML handlers (`onclick`, `onchange`, etc.) call these on `window`.
 * Assigned in `main.ts` via `registerWindowHandlers()`.
 */
export {};

declare global {
  interface Window {
    toggleSidebarLayout: () => void;
    createChat: () => void;
    fetchModels: () => Promise<void>;
    toggleDrawer: () => void;
    closeDrawer: () => void;
    onDrawerKeydown: (e: KeyboardEvent) => void;
    clearChat: () => void;
    closeMobileSidebar: () => void;
    toggleSidebarCollapsed: () => void;
    sendMessage: () => Promise<void>;
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
  }
}
