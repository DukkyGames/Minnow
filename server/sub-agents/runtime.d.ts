import type { DeliveryHandle, ParentStatus } from './delivery';

export function getProductionDelivery(): DeliveryHandle;
export function bootAgentsRuntime(): Promise<void>;
export function resetProductionDelivery(): void;
export function setProductionParentStatus(
  fn: ((parentChatId: string) => ParentStatus) | null,
): void;
