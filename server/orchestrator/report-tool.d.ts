import type { ParseReportResult as RunnerParseReportResult, TurnToolDefinition } from '../runner/run-turn';

/** Same name `runTurn` injects by default. Not a role name. */
export const REPORT_TOOL_NAME: 'report_outcome';

/**
 * Execute-time parse result. Compatible with `runTurn({ parseReport })`.
 * `ok: false` is a tool-boundary rejection, not `no_report`.
 */
export type ParseReportResult = RunnerParseReportResult;

export function parseBuilderReport(raw: unknown): ParseReportResult;
export function parseTesterReport(raw: unknown): ParseReportResult;
export function parseReportFor(role: 'builder' | 'tester'): (raw: unknown) => ParseReportResult;

export function builderReportTool(): TurnToolDefinition;
export function testerReportTool(): TurnToolDefinition;
export function reportToolFor(role: 'builder' | 'tester'): TurnToolDefinition;
