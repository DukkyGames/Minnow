import type { EmailMessage } from '../../email/client';

export type MailStoreListener = (state: MailStoreState) => void;

export interface MailStoreState {
  messages: EmailMessage[];
  total: number;
}

/** A reversible local edit. */
interface PendingMutation {
  id: string;
  restore: () => void;
}

export interface MailStore {
  getState(): MailStoreState;
  subscribe(listener: MailStoreListener): () => void;
  /** Replace the contents after a real fetch. */
  replace(messages: EmailMessage[], total: number): void;
  get(id: string): EmailMessage | undefined;
  /** Apply `patch` immediately, run `commit`, and roll back if it rejects. */
  mutate(
    id: string,
    patch: Partial<EmailMessage>,
    commit: () => Promise<unknown>,
  ): Promise<boolean>;
  /** Optimistically drop a row (archive, move, delete), restoring on failure. */
  remove(id: string, commit: () => Promise<unknown>): Promise<boolean>;
  /** Fold a server-sent change in without a refetch. */
  applyServerFlags(id: string, flags: EmailMessage['flags']): void;
  pendingCount(): number;
}

/** Deep-enough clone for the fields a mutation touches. */
function snapshot(message: EmailMessage): EmailMessage {
  return { ...message, flags: { ...(message.flags ?? { seen: false, flagged: false }) } };
}

export function createMailStore(options: {
  onError?: (message: string) => void;
} = {}): MailStore {
  let messages: EmailMessage[] = [];
  let total = 0;
  const listeners = new Set<MailStoreListener>();
  const pending = new Map<string, PendingMutation>();

  const emit = (): void => {
    const state: MailStoreState = { messages, total };
    for (const listener of listeners) listener(state);
  };

  const indexOf = (id: string): number => messages.findIndex((row) => row.id === id);

  return {
    getState: () => ({ messages, total }),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    replace(next, nextTotal) {
      messages = next;
      total = nextTotal;
      pending.clear();
      emit();
    },

    get(id) {
      return messages[indexOf(id)];
    },

    async mutate(id, patch, commit) {
      const index = indexOf(id);
      if (index < 0) return false;

      const before = snapshot(messages[index]);
      const after: EmailMessage = {
        ...messages[index],
        ...patch,
        flags: { ...(messages[index].flags ?? { seen: false, flagged: false }), ...(patch.flags ?? {}) },
      };

      messages = [...messages.slice(0, index), after, ...messages.slice(index + 1)];
      const restore = (): void => {
        const at = indexOf(id);
        if (at < 0) return;
        messages = [...messages.slice(0, at), before, ...messages.slice(at + 1)];
      };
      pending.set(id, { id, restore });
      emit();

      try {
        await commit();
        pending.delete(id);
        return true;
      } catch (err) {
        if (pending.get(id)?.restore === restore) {
          restore();
          pending.delete(id);
          emit();
        }
        options.onError?.(err instanceof Error ? err.message : 'Action failed');
        return false;
      }
    },

    async remove(id, commit) {
      const index = indexOf(id);
      if (index < 0) return false;

      const before = messages[index];
      messages = [...messages.slice(0, index), ...messages.slice(index + 1)];
      total = Math.max(0, total - 1);
      const restore = (): void => {
        if (indexOf(id) >= 0) return;
        messages = [...messages.slice(0, index), before, ...messages.slice(index)];
        total += 1;
      };
      pending.set(id, { id, restore });
      emit();

      try {
        await commit();
        pending.delete(id);
        return true;
      } catch (err) {
        if (pending.get(id)?.restore === restore) {
          restore();
          pending.delete(id);
          emit();
        }
        options.onError?.(err instanceof Error ? err.message : 'Action failed');
        return false;
      }
    },

    applyServerFlags(id, flags) {
      const index = indexOf(id);
      if (index < 0) return;
      if (pending.has(id)) return;

      messages = [
        ...messages.slice(0, index),
        { ...messages[index], flags: { ...(messages[index].flags ?? { seen: false, flagged: false }), ...flags } },
        ...messages.slice(index + 1),
      ];
      emit();
    },

    pendingCount: () => pending.size,
  };
}
