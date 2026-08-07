/** Legacy desktop chat session activation — routes through Code chat. */
export async function activateDesktopChatSession(chatId: string): Promise<void> {
  const { switchToCodeChat } = await import('./chat-launch');
  await switchToCodeChat(chatId);
}

/** Tray / native entry: new general chat in Code. */
export async function startNewDesktopGeneralChat(): Promise<void> {
  const { launchApp } = await import('./router');
  const { ensureSessionsReady } = await import('../state/sessions');
  launchApp('code', { codeSection: 'chat' });
  await ensureSessionsReady();
}

export function renderDesktopChatMessages(): void {
  /* no-op */
}

export function syncDesktopChatSessionSwitch(): void {
  /* no-op */
}

export function wireDesktopComposerControls(): void {
  /* no-op */
}

export function getDesktopChatScrollElement(): HTMLElement | null {
  return null;
}
