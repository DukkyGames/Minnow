/**
 * Single-driver lease for orchestrate board auto-run (Phase 0).
 * Only the lease holder may run bootOrchestrateBoardResume / autoDelegateNext.
 */

/** Lease TTL — clients renew before this expires. */
const LEASE_TTL_MS = 30_000;

/**
 * @typedef {{ driverId: string, label: string, expiresAt: number }} BoardDriverLease
 */

/** @type {BoardDriverLease | null} */
let activeLease = null;

/**
 * @param {string} driverId
 * @param {string} [label]
 * @returns {{ ok: true, held: true } | { ok: true, held: false, holder?: BoardDriverLease }}
 */
export function claimBoardDriverLease(driverId, label = '') {
  const id = driverId.trim();
  if (!id) {
    return { ok: true, held: false };
  }

  const now = Date.now();
  if (activeLease && activeLease.expiresAt > now && activeLease.driverId !== id) {
    return { ok: true, held: false, holder: { ...activeLease } };
  }

  activeLease = {
    driverId: id,
    label: label.trim() || id.slice(0, 8),
    expiresAt: now + LEASE_TTL_MS,
  };
  return { ok: true, held: true };
}

/**
 * @param {string} driverId
 * @returns {{ ok: true, held: boolean }}
 */
export function renewBoardDriverLease(driverId) {
  const id = driverId.trim();
  if (!id || !activeLease || activeLease.driverId !== id) {
    return { ok: true, held: false };
  }
  activeLease.expiresAt = Date.now() + LEASE_TTL_MS;
  return { ok: true, held: true };
}

/**
 * @param {string} driverId
 */
export function releaseBoardDriverLease(driverId) {
  const id = driverId.trim();
  if (!activeLease || activeLease.driverId !== id) return;
  activeLease = null;
}

/**
 * @returns {BoardDriverLease | null}
 */
export function getBoardDriverLease() {
  if (!activeLease) return null;
  if (activeLease.expiresAt <= Date.now()) {
    activeLease = null;
    return null;
  }
  return { ...activeLease };
}

/** @param {string} driverId @returns {boolean} */
export function holdsBoardDriverLease(driverId) {
  const lease = getBoardDriverLease();
  return Boolean(lease && lease.driverId === driverId.trim());
}

/** Reset lease state (tests). */
export function resetBoardDriverLeaseForTests() {
  activeLease = null;
}
