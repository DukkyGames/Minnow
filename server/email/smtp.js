/**
 * SMTP draft and send (explicit user action only — no auto-send tools).
 */

import nodemailer from 'nodemailer';
import { getEmailAccount, readAccountPassword } from './accounts.js';
import { listCachedThread } from './cache.js';

/**
 * Infer nodemailer transport security from account SMTP settings.
 * @param {{ host: string, port: number, starttls: boolean }} smtp
 */
function buildTransportOptions(smtp, username, password) {
  const secure = !smtp.starttls && smtp.port === 465;
  return {
    host: smtp.host,
    port: smtp.port,
    secure,
    auth: { user: username, pass: password },
    requireTLS: smtp.starttls,
  };
}

/**
 * Compose a reply draft for a thread (does not send).
 * @param {{ accountId: string, threadId: string, instructions?: string }} input
 */
export async function draftReply(input) {
  const account = await getEmailAccount(input.accountId);
  if (!account) {
    throw new Error('Email account not found');
  }

  const thread = await listCachedThread(input.accountId, input.threadId);
  if (thread.length === 0) {
    throw new Error('Thread not found in cache — sync the folder first');
  }

  const latest = thread[thread.length - 1];
  const subject = String(latest.subject ?? '').trim();
  const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const to = String(latest.from ?? '').trim();
  const inReplyTo = String(latest.messageId ?? '');
  const references = [inReplyTo, ...(Array.isArray(latest.references) ? latest.references : [])]
    .filter(Boolean)
    .join(' ');

  const instructions = String(input.instructions ?? '').trim();
  const bodyLines = [
    '',
    '',
    '---',
    `On ${latest.date}, ${latest.from} wrote:`,
    String(latest.bodyPreview ?? ''),
  ];

  const draftBody = instructions
    ? `${instructions}\n${bodyLines.join('\n')}`
    : `\n${bodyLines.join('\n')}`;

  return {
    accountId: input.accountId,
    threadId: input.threadId,
    to,
    subject: replySubject,
    inReplyTo,
    references,
    body: draftBody,
    note: 'Draft only — review and send explicitly from the Email app.',
  };
}

/**
 * Send an email after explicit user confirmation.
 * @param {{ accountId: string, to: string, subject: string, body: string, inReplyTo?: string, references?: string, confirmed: boolean }} input
 */
export async function sendEmail(input) {
  if (!input.confirmed) {
    throw new Error('Send requires explicit user confirmation (confirmed: true)');
  }

  const account = await getEmailAccount(input.accountId);
  if (!account) {
    throw new Error('Email account not found');
  }
  if (!account.smtp?.host) {
    throw new Error('SMTP is not configured for this account');
  }

  const to = String(input.to ?? '').trim();
  const subject = String(input.subject ?? '').trim();
  const body = String(input.body ?? '');
  if (!to || !subject) {
    throw new Error('to and subject are required');
  }

  const password = await readAccountPassword(input.accountId);
  const transport = nodemailer.createTransport(
    buildTransportOptions(account.smtp, account.username, password),
  );

  const from = account.fromAddress?.trim() || account.username;
  const info = await transport.sendMail({
    from,
    to,
    subject,
    text: body,
    inReplyTo: input.inReplyTo || undefined,
    references: input.references || undefined,
  });

  return {
    ok: true,
    messageId: info.messageId ?? null,
    accepted: info.accepted ?? [],
    rejected: info.rejected ?? [],
  };
}
