import type { Chat, ChatGroup } from '../types';

export const SESSION_SCHEMA_VERSION: number;
export function normalizeWorkspacePath(fsPath: unknown): string;
export function migrateChatRowV5ToV6(chat: unknown): unknown;
export function normalizeGroupRow(raw: unknown): ChatGroup;
export function normalizeChatRow(raw: unknown): Chat;
export function normalizeSessionScalars(raw: unknown, options?: object): unknown;
