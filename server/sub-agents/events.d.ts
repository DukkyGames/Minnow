import type {
  AttemptOutcome,
  EventSchema,
  FieldType,
  SubAgentRole,
  ValidationResult,
} from './types';

export const ENVELOPE_VERSION: number;
export const ATTEMPT_OUTCOMES: readonly AttemptOutcome[];
export const SUB_AGENT_ROLE: SubAgentRole;
export const EVENT_SCHEMAS: Readonly<Record<string, EventSchema>>;
export const EVENT_TYPES: string[];

export type { FieldType };

export function isKnownEventType(type: unknown): boolean;
export function validateEvent(raw: unknown): ValidationResult;
export function makeEvent(type: string, payload?: Record<string, unknown>): Record<string, unknown>;
