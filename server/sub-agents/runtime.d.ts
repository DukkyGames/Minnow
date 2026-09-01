import type { DeliveryHandle, ParentStatus } from './delivery';

export function getProductionDelivery(): DeliveryHandle;
export function bootAgentsRuntime(): Promise<void>;
export function resetProductionDelivery(): void;
/** P8-H test seam: flip "parent is streaming" without rebuilding the handle. */
export function setProductionParentStatus(
  fn: ((parentChatId: string) => ParentStatus) | null,
): void;
