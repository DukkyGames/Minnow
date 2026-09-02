import type { ParseReportResult as RunnerParseReportResult, TurnToolDefinition } from '../runner/run-turn';

/** Same name `runTurn` injects by default. Not a role name. */
export const REPORT_TOOL_NAME: 'report_outcome';

/**
 * Execute-time parse result.
 */
export type ParseReportResult = RunnerParseReportResult;

export function parseBuilderReport(raw: unknown): ParseReportResult;
export function parseTesterReport(raw: unknown): ParseReportResult;
export function parseReportFor(role: 'builder' | 'tester' | 'final'): (raw: unknown) => ParseReportResult;

export function builderReportTool(): TurnToolDefinition;
export function testerReportTool(): TurnToolDefinition;
export function reportToolFor(role: 'builder' | 'tester' | 'final'): TurnToolDefinition;
