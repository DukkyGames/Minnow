import type { AttemptResult, Role, StopReason, ValidationResult } from './types';

/** Envelope version this build writes. Readers tolerate anything >= 1. */
export const ENVELOPE_VERSION: number;

export const ATTEMPT_OUTCOMES: readonly AttemptResult[];
export const ROLES: readonly Role[];
export const STOP_REASONS: readonly StopReason[];

/** Field type vocabulary used by the schema table. */
export type FieldType =
  | 'id'
  | 'str'
  | 'int'
  | 'posint'
  | 'str[]'
  | 'obj[]'
  | 'obj'
  | { enum: readonly string[] };

export interface EventSchema {
  readonly required: Readonly<Record<string, FieldType>>;
  readonly optional: Readonly<Record<string, FieldType>>;
}

/** The event vocabulary, as data. */
export const EVENT_SCHEMAS: Readonly<Record<string, EventSchema>>;

/** Every known event type, in declaration order. */
export const EVENT_TYPES: string[];

/** Is this a type the fold understands? Unknown types are tolerated, not invalid. */
export function isKnownEventType(type: unknown): boolean;

/**
 * Validate one raw journal line.
 */
export function validateEvent(raw: unknown): ValidationResult;

/** Build an envelope around a payload. The journal writer stamps `seq` and `ts`. */
export function makeEvent(type: string, payload?: Record<string, unknown>): Record<string, unknown>;
