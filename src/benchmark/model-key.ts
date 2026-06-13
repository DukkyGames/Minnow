/**
 * Stable keys for benchmark targets (provider + model).
 */

import type { BenchmarkTarget } from './campaign-types.ts';

export function buildTargetKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function targetKeyFromTarget(target: BenchmarkTarget): string {
  return buildTargetKey(target.providerId, target.modelId);
}

export function targetLabel(target: BenchmarkTarget): string {
  const custom = target.label?.trim();
  if (custom) return custom;
  return `${target.providerId} / ${target.modelId}`;
}

export function buildCellId(targetKey: string, testId: string): string {
  return `${targetKey}__${testId}`;
}
