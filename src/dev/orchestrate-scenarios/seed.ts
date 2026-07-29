/**
 * Small deterministic PRNG used to replay generated scenario choices.
 */

export interface DeterministicScenarioSeed {
  readonly value: string;
  nextUint32(): number;
  nextFloat(): number;
  integer(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
  derive(label: string): DeterministicScenarioSeed;
}

function normalizedSeed(value: string | number): string {
  const seed = String(value).trim();
  if (!seed) {
    throw new Error('Scenario seed must not be empty');
  }
  return seed;
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Create an isolated deterministic seed stream without filesystem or clock input. */
export function createDeterministicScenarioSeed(
  input: string | number,
): DeterministicScenarioSeed {
  const value = normalizedSeed(input);
  let state = hashSeed(value);

  const seed: DeterministicScenarioSeed = {
    value,
    nextUint32() {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return (mixed ^ (mixed >>> 14)) >>> 0;
    },
    nextFloat() {
      return seed.nextUint32() / 0x1_0000_0000;
    },
    integer(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new Error('Scenario integer range must contain safe integers with max >= min');
      }
      const span = max - min + 1;
      if (span > 0x1_0000_0000) {
        throw new Error('Scenario integer range must not exceed 2^32 values');
      }
      return min + Math.floor(seed.nextFloat() * span);
    },
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) {
        throw new Error('Cannot pick from an empty scenario value list');
      }
      return values[seed.integer(0, values.length - 1)] as T;
    },
    derive(label) {
      const normalizedLabel = normalizedSeed(label);
      return createDeterministicScenarioSeed(`${value}:${normalizedLabel}`);
    },
  };
  return seed;
}
