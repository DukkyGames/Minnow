/**
 * Server-side destructive tools require confirmed: true after user approval.
 * When the user approves via the Ask permission strip, treat that as confirmation.
 */

const MANAGE_BRAIN_DESTRUCTIVE = new Set([
  'delete_page',
  'clear_wiki',
  'delete_archive',
  'clear_proposals',
  'clear_code_index',
  'clear_sources',
]);

function isConfirmed(args: Record<string, unknown>): boolean {
  return args.confirmed === true || args.confirm === true;
}

/**
 * Mutates args in place when the user approved a destructive tool via the Ask strip.
 */
export function applyDestructiveConfirmationAfterUserApproval(
  permissionToolId: string,
  args: Record<string, unknown>,
): void {
  if (isConfirmed(args)) return;

  if (permissionToolId === 'update_settings') {
    args.confirmed = true;
    return;
  }

  if (permissionToolId === 'manage_brain') {
    const action = String(args.action ?? '').trim();
    if (MANAGE_BRAIN_DESTRUCTIVE.has(action)) {
      args.confirmed = true;
    }
    return;
  }

  if (permissionToolId === 'manage_calendar' && String(args.action ?? '').trim() === 'delete') {
    args.confirmed = true;
  }
}
