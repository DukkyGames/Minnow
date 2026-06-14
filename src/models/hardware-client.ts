import type { HardwareSnapshot } from './types';

export async function fetchHardware(options?: { fresh?: boolean }): Promise<HardwareSnapshot> {
  const url = options?.fresh ? '/api/system/hardware?fresh=1' : '/api/system/hardware';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Hardware probe failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as HardwareSnapshot;
}
