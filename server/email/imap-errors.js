/**
 * User-facing IMAP error messages.
 * imapflow rejects NO/BAD responses with a generic "Command failed" Error;
 * the useful server text lives on err.responseText.
 */

/** @typedef {import('./accounts.js').EmailAccount} EmailAccount */

const MICROSOFT_HOST_MARKERS = [
  'outlook.office365.com',
  'smtp.office365.com',
  'office365.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
];

/**
 * @param {string} host
 */
function isMicrosoftHost(host) {
  const lower = host.toLowerCase();
  return MICROSOFT_HOST_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * @param {string} detail
 */
function isMicrosoftBasicAuthFailure(detail) {
  const lower = detail.toLowerCase();
  return (
    lower.includes('5.7.139') ||
    lower.includes('basic authentication is disabled') ||
    lower.includes('authenticate failed') ||
    lower.includes('authentication unsuccessful')
  );
}

/**
 * @param {unknown} err
 */
function readImapDetail(err) {
  if (err && typeof err === 'object') {
    const responseText = /** @type {{ responseText?: string }} */ (err).responseText;
    if (typeof responseText === 'string' && responseText.trim()) {
      return responseText.trim();
    }
  }
  if (err instanceof Error && err.message.trim() && err.message !== 'Command failed') {
    return err.message.trim();
  }
  return '';
}

/**
 * Turn imapflow / network errors into actionable setup messages.
 * @param {EmailAccount} account
 * @param {unknown} err
 */
export function formatImapError(account, err) {
  const host = account?.imap?.host ?? '';
  const detail = readImapDetail(err);
  const code =
    err && typeof err === 'object' && typeof /** @type {{ code?: string }} */ (err).code === 'string'
      ? /** @type {{ code: string }} */ (err).code
      : '';
  const authFailed = Boolean(
    err && typeof err === 'object' && /** @type {{ authenticationFailed?: boolean }} */ (err).authenticationFailed,
  );

  if (code === 'ECONNREFUSED') {
    return `Could not connect to IMAP server at ${host}:${account.imap.port} (connection refused)`;
  }
  if (code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ESOCKETTIMEDOUT') {
    return `Could not reach IMAP server at ${host}:${account.imap.port} (${code})`;
  }
  if (code === 'ECONNRESET') {
    return `IMAP connection to ${host} was reset — check host, port, and TLS settings`;
  }
  if (code === 'ETHROTTLE') {
    return detail || 'IMAP server is throttling requests — try again in a few minutes';
  }

  if (isMicrosoftHost(host) && (authFailed || isMicrosoftBasicAuthFailure(detail))) {
    return (
      'Microsoft no longer accepts normal mailbox passwords for Outlook/Office 365 IMAP/SMTP in most accounts. ' +
      'Use an app-specific password if your tenant still allows basic auth, or connect a provider that supports IMAP passwords (e.g. Fastmail).'
    );
  }

  if (host.toLowerCase().includes('gmail.com') && authFailed) {
    return (
      'Gmail rejected the login. Use a 16-character App Password (not your Google account password) ' +
      'with 2-Step Verification enabled.' +
      (detail ? ` Server said: ${detail}` : '')
    );
  }

  if (authFailed) {
    return detail ? `IMAP authentication failed: ${detail}` : 'IMAP authentication failed — check username and password';
  }

  if (detail) {
    return `IMAP error: ${detail}`;
  }

  return 'IMAP command failed — check host, port, TLS, and credentials';
}

/**
 * Run an IMAP operation and rethrow with a friendly message.
 * @template T
 * @param {EmailAccount} account
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function withImapErrors(account, operation) {
  try {
    return await operation();
  } catch (err) {
    throw new Error(formatImapError(account, err));
  }
}
