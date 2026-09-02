import { forkFromUserIndex } from './fork-from-run';

/** Resend from a user history index (truncate after, then run tool loop). */
export async function resendFromIndex(
  chatId: string,
  userHistoryIndex: number,
): Promise<void> {
  await forkFromUserIndex(chatId, userHistoryIndex);
}
