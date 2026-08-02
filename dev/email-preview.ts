/**
 * Email app preview harness (dev-only, not shipped).
 *
 * Mounts the real Email UI modules against an in-memory fixture backend so every
 * state and viewport can be inspected without a live IMAP account. The whole
 * `/api/email/*` surface is stubbed on `window.fetch`; SSE is a controllable
 * emitter. Pick a scene with `?scene=`, a palette with `?theme=`.
 *
 *   /dev/email-preview.html?scene=panel&theme=swamp-dark
 *
 * Scenes: panel (default) · dashboard · mail · compose · automations · unified ·
 *         setup · error
 */

import '../src/styles/fonts.css';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/styles/motion.css';
import '../src/styles/app-dialog.css';
import '../src/styles/email.css';

import type {
  EmailAccount,
  EmailAttachment,
  EmailFollowup,
  EmailInboxSummary,
  EmailMessage,
  EmailNarrativeDigest,
  EmailPendingAction,
  EmailThreadSummary,
  OutboxEntry,
  ReplyVariant,
} from '../src/email/client';

import { renderEmailPanel } from '../src/ui/email/email-panel';
import { renderEmailDashboard } from '../src/ui/email/email-dashboard';
import { renderEmailLayout } from '../src/ui/email/email-layout';
import { renderEmailAutomations } from '../src/ui/email/email-automations';
import { mountEmailCompose } from '../src/ui/email/email-compose';
import { renderUnifiedInbox } from '../src/ui/email/email-unified';

// ---------------------------------------------------------------------------
// Clock helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();
const mins = (n: number): number => n * 60_000;
const hours = (n: number): number => n * 3_600_000;
const days = (n: number): number => n * 86_400_000;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const accounts: EmailAccount[] = [
  {
    id: 'acc-personal',
    label: 'Personal',
    imap: { host: 'imap.fastmail.com', port: 993, tls: true },
    smtp: { host: 'smtp.fastmail.com', port: 587, starttls: true },
    username: 'user@example.com',
    fromAddress: 'user@example.com',
    isDefault: true,
    pollingEnabled: true,
    pollingIntervalMinutes: 5,
    folders: ['INBOX', 'Sent', 'Drafts', 'Archive', 'Trash', 'Spam'],
    signature: '—\nAlex',
    followupTracking: true,
    styleProfileEnabled: false,
  },
  {
    id: 'acc-work',
    label: 'Work',
    imap: { host: 'imap.gmail.com', port: 993, tls: true },
    smtp: { host: 'smtp.gmail.com', port: 587, starttls: true },
    username: 'work@example.com',
    fromAddress: 'work@example.com',
    isDefault: false,
    pollingEnabled: false,
    pollingIntervalMinutes: 15,
    folders: ['INBOX', 'Sent', 'Archive', 'Trash'],
    signature: '',
    followupTracking: true,
    styleProfileEnabled: false,
  },
];

const variant = (id: string, label: string, body: string): ReplyVariant => ({
  id,
  label,
  body,
  createdAt: iso(-mins(4)),
});

const att = (
  index: number,
  filename: string,
  contentType: string,
  size: number,
  extra: Partial<EmailAttachment> = {},
): EmailAttachment => ({ index, filename, contentType, size, ...extra });

interface SeedMessage extends EmailMessage {
  accountId: string;
}

/** One inbox per account, keyed by id, so mutations survive a refetch. */
function seedMessages(): SeedMessage[] {
  const rows: SeedMessage[] = [];

  const push = (m: Partial<SeedMessage> & Pick<SeedMessage, 'id' | 'from' | 'subject'>): void => {
    rows.push({
      accountId: 'acc-personal',
      uid: m.id!.replace(/\D/g, '') || '1',
      threadId: m.threadId ?? m.id!,
      folder: 'INBOX',
      to: ['user@example.com'],
      date: iso(-mins(12)),
      bodyPreview: '',
      hasAttachments: false,
      flags: { seen: false, flagged: false },
      ...m,
    } as SeedMessage);
  };

  push({
    id: 'm-contract',
    threadId: 't-contract',
    from: 'Femi Adebayo <femi@northwind.co>',
    subject: 'Re: Northwind retainer — signature needed today',
    date: iso(-mins(38)),
    bodyPreview: 'Legal cleared the redlines. We just need your signature before 5pm to keep the start date.',
    bodyText:
      'Hi Alex,\n\nLegal cleared the last redlines this morning. We just need your signature on the retainer before 5pm today to keep the March 1 start date — otherwise procurement rolls us to next cycle.\n\nDocuSign link is in the previous mail. Shout if anything looks off.\n\nThanks,\nFemi',
    flags: { seen: false, flagged: true },
    triage: {
      summary: 'Femi needs the Northwind retainer signed before 5pm today to hold the start date.',
      tags: ['contract', 'deadline'],
      urgency: 'high',
      category: 'needs_reply',
      deadline: new Date(NOW + hours(4)).toISOString().slice(0, 10),
      people: ['Femi Adebayo'],
      cachedAt: iso(-mins(30)),
    },
    replyVariants: [
      variant('v-sign', 'Confirm signing', 'Hi Femi, signing now — you\'ll have it back within the hour. Thanks for pushing this through legal so quickly.'),
      variant('v-question', 'Ask one question', 'Hi Femi, almost there. One check before I sign: does clause 7 still cap liability at fees paid? If so I\'m good to go this afternoon.'),
    ],
  });

  push({
    id: 'm-news',
    threadId: 't-news',
    from: 'Retool Weekly <newsletter@retool.email>',
    subject: 'The internal-tools roundup: 7 patterns worth stealing',
    date: iso(-hours(3)),
    bodyPreview: 'This week: approval queues that don\'t annoy people, and a calmer take on audit logs.',
    bodyHtml:
      '<div style="font-family:Georgia,serif;max-width:600px">' +
      '<img src="https://cdn.retool.email/hero-2048.jpg" alt="Retool Weekly" width="600" height="240" style="border-radius:8px">' +
      '<h1 style="color:#3b19e6">7 patterns worth stealing</h1>' +
      '<p>This week we look at approval queues that don\'t annoy people, a calmer take on audit logs, and why your empty states are doing more work than you think.</p>' +
      '<p><a href="https://retool.email/read/1234">Read the full issue →</a></p>' +
      '<img src="https://track.retool.email/o/abc123.gif" width="1" height="1" alt="">' +
      '</div>',
    bodyText: 'This week: approval queues that don\'t annoy people, and a calmer take on audit logs. Read online at retool.email.',
    triage: {
      summary: 'Weekly internal-tools newsletter. No action needed.',
      tags: ['newsletter'],
      urgency: 'low',
      category: 'newsletter',
      cachedAt: iso(-hours(2)),
    },
  });

  push({
    id: 'm-ci',
    threadId: 't-ci',
    from: 'GitHub Actions <noreply@github.com>',
    subject: '[minnow] Run failed: Nightly e2e (main)',
    date: iso(-hours(5)),
    bodyPreview: 'The workflow Nightly e2e failed on a flaky screenshot diff. 1 of 42 jobs affected.',
    bodyText: 'The workflow "Nightly e2e" failed. Job: visual-regression. 1 of 42 checks failed on a flaky screenshot diff. Re-run available.',
    flags: { seen: true, flagged: false },
    triage: {
      summary: 'A single flaky nightly e2e job failed. Safe to re-run or archive.',
      tags: ['ci'],
      urgency: 'low',
      category: 'notification',
      cachedAt: iso(-hours(4)),
    },
  });

  push({
    id: 'm-longthread',
    threadId: 't-planning',
    from: 'Dana Cho <dana@studio.io>',
    subject: 'Q2 planning — narrowing the roadmap',
    date: iso(-hours(20)),
    bodyPreview: 'Pulling the thread together before Thursday. Here is where I think we landed.',
    bodyText: 'Pulling the thread together before Thursday. Here is where I think we landed on scope, staffing, and the two features we are cutting.',
    flags: { seen: true, flagged: false },
    triage: {
      summary: 'Dana is consolidating the Q2 roadmap thread ahead of Thursday.',
      tags: ['planning'],
      urgency: 'normal',
      category: 'needs_reply',
      cachedAt: iso(-hours(19)),
    },
  });

  push({
    id: 'm-receipt',
    threadId: 't-receipt',
    from: 'Fly.io <billing@fly.io>',
    subject: 'Your receipt for February',
    date: iso(-days(1)),
    bodyPreview: 'Thanks — your card was charged $28.14 for February usage.',
    bodyText: 'Thanks for using Fly.io. Your card ending 4242 was charged $28.14 for February usage. Invoice attached.',
    flags: { seen: true, flagged: false },
    hasAttachments: true,
    attachments: [att(0, 'invoice-february.pdf', 'application/pdf', 48_210)],
    triage: {
      summary: 'Monthly Fly.io receipt, $28.14. Invoice PDF attached.',
      tags: ['receipt'],
      urgency: 'low',
      category: 'receipt',
      cachedAt: iso(-hours(23)),
    },
  });

  push({
    id: 'm-security',
    threadId: 't-security',
    from: 'Google <no-reply@accounts.google.com>',
    subject: 'Security alert: new sign-in on Windows',
    date: iso(-days(1) - hours(2)),
    bodyPreview: 'Your account was just signed in to on a new Windows device. Was this you?',
    bodyText: 'Your Google Account was just signed in to on a new Windows device in Berlin. If this was you, you can ignore this message.',
    flags: { seen: false, flagged: false },
    triage: {
      summary: 'New Windows sign-in from Berlin. Verify it was you.',
      tags: ['security'],
      urgency: 'high',
      category: 'security',
      cachedAt: iso(-days(1)),
    },
  });

  push({
    id: 'm-photos',
    threadId: 't-photos',
    from: 'Priya Nair <priya@meadowlark.studio>',
    subject: 'Cover options for the case study',
    date: iso(-days(2)),
    bodyPreview: 'Two directions attached — the muted one and the bolder one. Which reads better to you?',
    bodyText: 'Hi Alex, two cover directions attached — the muted one and the bolder one. Which reads better to you for the case study header?',
    flags: { seen: true, flagged: false },
    hasAttachments: true,
    attachments: [
      att(0, 'cover-muted.png', 'image/png', 812_004),
      att(1, 'cover-bold.png', 'image/png', 903_551),
    ],
    triage: {
      summary: 'Priya is asking which of two cover images reads better.',
      tags: ['design'],
      urgency: 'normal',
      category: 'needs_reply',
      cachedAt: iso(-days(2) + hours(1)),
    },
  });

  push({
    id: 'm-calendar',
    threadId: 't-calendar',
    from: 'Calendly <notifications@calendly.com>',
    subject: 'New event: Intro call with Marlow & Finch',
    date: iso(-days(3)),
    bodyPreview: 'A new event has been scheduled for Wednesday at 14:00.',
    bodyText: 'A new event has been scheduled. Intro call with Marlow & Finch. Wednesday, 14:00–14:30. Video link included.',
    flags: { seen: true, flagged: false },
    triage: {
      summary: 'Intro call scheduled for Wednesday 14:00.',
      tags: ['calendar'],
      urgency: 'normal',
      category: 'calendar',
      cachedAt: iso(-days(3) + hours(1)),
    },
  });

  return rows;
}

/** Multi-message body for the long "Catch up" thread. */
function planningThread(): EmailMessage[] {
  const base = seedMessages().find((m) => m.threadId === 't-planning')!;
  const mk = (i: number, from: string, offset: number, body: string): EmailMessage => ({
    ...base,
    id: `t-planning-${i}`,
    uid: String(500 + i),
    from,
    date: iso(offset),
    bodyText: body,
    bodyPreview: body.slice(0, 90),
    flags: { seen: true, flagged: false },
    attachments: undefined,
    hasAttachments: false,
    replyVariants: undefined,
  });
  return [
    mk(1, 'Dana Cho <dana@studio.io>', -days(3), 'Kicking off Q2 planning. Can everyone drop their top three priorities by Friday?'),
    mk(2, 'Alex <user@example.com>', -days(2) - hours(6), 'Mine: ship the email polish pass, land the billing rework, and cut scope on the mobile app.'),
    mk(3, 'Sam Ortiz <sam@studio.io>', -days(2), 'Agree on billing. I would push the mobile app to Q3 rather than cut it — the groundwork is half done.'),
    mk(4, 'Dana Cho <dana@studio.io>', -days(1) - hours(4), 'Fair. Let us hold mobile for Q3 and use the freed time to stabilise CI, which keeps biting us.'),
    mk(5, 'Dana Cho <dana@studio.io>', -hours(20), 'Pulling the thread together before Thursday. Here is where I think we landed on scope, staffing, and the two features we are cutting.'),
  ];
}

const summary: EmailInboxSummary = (() => {
  const rows = seedMessages();
  const highlights: EmailInboxSummary['highlights'] = rows
    .filter((m) => m.triage)
    .map((m) => ({
      threadId: m.threadId,
      messageId: m.id,
      subject: m.subject,
      from: m.from,
      urgency: m.triage!.urgency,
      category: m.triage!.category,
      deadline: m.triage!.deadline,
      people: m.triage!.people,
      priority: m.triage!.urgency === 'high' ? 88 : m.triage!.urgency === 'low' ? 24 : 55,
      priorityBucket: m.triage!.urgency,
      summary: m.triage!.summary,
      unseen: !m.flags?.seen,
      replyVariants: m.replyVariants ?? [],
    }));
  return {
    generatedAt: iso(-mins(2)),
    text: '8 threads (3 unread). 2 high urgency, 1 waiting on a reply since Tuesday.',
    stats: { high: 2, normal: 3, low: 3 },
    unread: 3,
    highlights,
  };
})();

const digest: EmailNarrativeDigest = {
  narrative:
    'Femi needs the Northwind retainer signed before 5pm — that is the only thing on fire today. Priya is waiting on a cover pick and Dana has pulled the Q2 thread together for Thursday. The two newsletters and the flaky CI alert can go.',
  actionGroups: [
    { id: 'g-news', label: 'Archive 2 newsletters', action: 'archive', messageIds: ['m-news'], threadIds: ['t-news'] },
    { id: 'g-reply', label: '2 need replies', action: 'flag', messageIds: ['m-contract', 'm-photos'], threadIds: ['t-contract', 't-photos'] },
  ],
  generatedAt: iso(-mins(2)),
};

const pendingActions: EmailPendingAction[] = [
  {
    id: 'p-1',
    source: 'digest',
    label: 'Archive 2 newsletters',
    action: 'archive',
    messageIds: ['m-news'],
    threadIds: ['t-news'],
    destFolder: 'Archive',
    state: 'pending',
    detail: '',
    createdAt: iso(-mins(2)),
    resolvedAt: '',
  },
];

const followups: EmailFollowup[] = [
  {
    id: 'f-1',
    threadId: 't-invoice',
    messageId: 'm-invoice',
    to: 'accounts@harborside.co',
    subject: 'Invoice #2213 — payment status?',
    sentAt: iso(-days(4)),
    expectedBy: iso(-days(1)),
    state: 'waiting',
    notified: false,
    satisfiedAt: '',
    satisfiedBy: '',
  },
  {
    id: 'f-2',
    threadId: 't-intro',
    messageId: 'm-intro',
    to: 'jordan@lumen.dev',
    subject: 'Following up on the intro',
    sentAt: iso(-days(1)),
    expectedBy: iso(days(2)),
    state: 'waiting',
    notified: false,
    satisfiedAt: '',
    satisfiedBy: '',
  },
];

function threadSummaries(rows: SeedMessage[]): EmailThreadSummary[] {
  const byThread = new Map<string, SeedMessage[]>();
  for (const m of rows) {
    const list = byThread.get(m.threadId) ?? [];
    list.push(m);
    byThread.set(m.threadId, list);
  }
  return [...byThread.values()].map((list) => {
    const last = list[list.length - 1];
    const count = last.threadId === 't-planning' ? 5 : list.length;
    return {
      threadId: last.threadId,
      subject: last.subject,
      participants: [...new Set(list.map((m) => m.from))],
      messageCount: count,
      unreadCount: list.filter((m) => !m.flags?.seen).length,
      flagged: list.some((m) => m.flags?.flagged),
      hasAttachments: list.some((m) => m.hasAttachments),
      lastDate: last.date,
      folders: ['INBOX'],
      snippet: last.bodyPreview,
      summary: null,
    };
  });
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

const db = {
  all: seedMessages(),
  outbox: new Map<string, OutboxEntry>(),
  removed: new Set<string>(),
};

function inbox(): SeedMessage[] {
  return db.all.filter((m) => m.folder === 'INBOX' && !db.removed.has(m.id));
}

function messagesForThread(threadId: string): EmailMessage[] {
  if (threadId === 't-planning') return planningThread();
  return db.all.filter((m) => m.threadId === threadId);
}

function outboxEntry(to: string, subject: string, windowSec = 8): OutboxEntry {
  const id = `ob-${Math.random().toString(36).slice(2, 8)}`;
  const entry: OutboxEntry = {
    id,
    accountId: 'acc-personal',
    to,
    subject,
    status: 'queued',
    queuedAt: new Date().toISOString(),
    sendAt: new Date(Date.now() + windowSec * 1000).toISOString(),
    error: null,
  };
  db.outbox.set(id, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

const forceSummaryError = new URLSearchParams(location.search).get('scene') === 'error';
const failMode = new URLSearchParams(location.search).get('fail');

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A believable byte payload for the download/preview routes. */
function attachmentResponse(filename: string): Response {
  if (/\.(png|jpe?g|gif|webp)$/i.test(filename)) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">` +
      `<rect width="640" height="360" fill="#2a3a44"/>` +
      `<rect x="40" y="40" width="560" height="280" rx="12" fill="#3d5563"/>` +
      `<text x="320" y="196" font-family="system-ui" font-size="26" fill="#cfe3ee" text-anchor="middle">${filename}</text></svg>`;
    return new Response(new Blob([svg], { type: 'image/svg+xml' }), {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }
  const text = `Preview harness placeholder for ${filename}`;
  return new Response(new Blob([text], { type: 'application/octet-stream' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

type Handler = (m: RegExpMatchArray, init: RequestInit | undefined, url: URL) => Response | Promise<Response>;
const routes: Array<{ method: string; re: RegExp; handler: Handler }> = [];
const route = (method: string, re: RegExp, handler: Handler): void => {
  routes.push({ method, re, handler });
};
const readBody = (init: RequestInit | undefined): Record<string, unknown> => {
  if (typeof init?.body !== 'string') return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
};
const delay = <T>(value: T, ms: number): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

route('GET', /\/accounts$/, () => json({ accounts }));

route('GET', /\/accounts\/[^/]+\/summary$/, () => {
  if (forceSummaryError) return json({ error: 'IMAP authentication failed — check username and password' }, 401);
  return json({
    summary,
    unreadByFolder: { INBOX: summary.unread },
    digest,
    pendingActions,
    followups,
  });
});

route('GET', /\/accounts\/[^/]+\/folders$/, () =>
  json({
    folders: accounts[0].folders.map((path) => ({ path, name: path })),
  }),
);

route('GET', /\/accounts\/[^/]+\/threads$/, () => {
  const list = threadSummaries(inbox());
  return json({ threads: list, total: list.length });
});

route('GET', /\/accounts\/[^/]+\/threads\/([^/]+)$/, (m) =>
  json({ messages: messagesForThread(decodeURIComponent(m[1])) }),
);

route('POST', /\/accounts\/[^/]+\/threads\/[^/]+\/summary$/, () =>
  delay(
    json({
      eligible: true,
      summary: {
        text:
          'Dana kicked off Q2 planning; the team agreed to prioritise the billing rework and hold the mobile app for Q3 to stabilise CI. Dana is consolidating before Thursday.',
        bodyHash: 'abc',
        generatedAt: iso(0),
        messageCount: 5,
      },
    }),
    900,
  ),
);

route('GET', /\/accounts\/[^/]+\/messages$/, () => {
  const rows = inbox();
  return json({ messages: rows, total: rows.length, offset: 0, limit: 50 });
});

route('POST', /\/accounts\/[^/]+\/sync$/, () => {
  // ?fail=auth exercises the error deep-link: an auth failure should send the
  // panel to the account form with the password field lit.
  if (failMode === 'auth') {
    return delay(
      json(
        {
          error:
            'Gmail rejected the login. Use a 16-character App Password (not your Google account password) with 2-Step Verification enabled.',
        },
        401,
      ),
      700,
    );
  }
  // A visible pause so the sync progress bar has something to animate over.
  return delay(json({ synced: 3, folder: 'INBOX' }), 1400);
});

route('GET', /\/accounts\/[^/]+\/contacts$/, () => json({ contacts: [] }));
route('GET', /\/image-allowlist$/, () => json({ senders: [] }));
route('POST', /\/image-allowlist$/, (_m, init) => json({ senders: [String(readBody(init).sender ?? '')] }));
route('DELETE', /\/image-allowlist/, () => json({ senders: [] }));
route('GET', /\/preferences$/, () => json({ alwaysLoadRemoteImages: false }));
route('PATCH', /\/preferences$/, (_m, init) => {
  const body = readBody(init);
  return json({ alwaysLoadRemoteImages: body.alwaysLoadRemoteImages === true });
});

route('POST', /\/messages\/[^/]+\/flags$/, () => json({ ok: true }));
route('POST', /\/messages\/([^/]+)\/archive$/, (m) => {
  db.removed.add(decodeURIComponent(m[1]));
  return json({ ok: true });
});
route('POST', /\/messages\/([^/]+)\/move$/, (m) => {
  db.removed.delete(decodeURIComponent(m[1])); // move-back (undo) restores
  return json({ ok: true });
});
route('DELETE', /\/messages\/([^/?]+)/, (m) => {
  db.removed.add(decodeURIComponent(m[1]));
  return json({ ok: true });
});
route('POST', /\/messages\/[^/]+\/snooze$/, (_m, init) => {
  const body = readBody(init);
  return json({ message: { ...db.all[0], snoozeUntil: String(body.until ?? '') } });
});
route('POST', /\/messages\/bulk$/, (_m, init) => {
  const body = readBody(init);
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  if (body.action === 'archive' || body.action === 'delete') {
    for (const id of ids) db.removed.add(id);
  }
  return json({ ok: true, failed: 0 });
});

route('GET', /\/messages\/[^/]+\/attachments\/([^/?]+)/, (m, _init, url) => {
  const selector = decodeURIComponent(m[1]);
  // cid: parts are inline images inside the body iframe; serve them as images.
  const filename = selector.startsWith('cid:') ? 'inline.png' : `attachment-${selector}`;
  const knownName = url.searchParams.get('filename');
  return attachmentResponse(knownName || filename);
});

route('POST', /\/send$/, (_m, init) => {
  const body = readBody(init);
  return json({ queued: true, entry: outboxEntry(String(body.to ?? 'someone@example.com'), String(body.subject ?? '(no subject)')) });
});
route('GET', /\/outbox$/, () => json({ entries: [...db.outbox.values()] }));
route('DELETE', /\/outbox\/([^/]+)$/, (m) => {
  const id = decodeURIComponent(m[1]);
  const entry = db.outbox.get(id);
  if (!entry) return json({ error: 'Too late to cancel — the message was sent' }, 409);
  entry.status = 'cancelled';
  db.outbox.delete(id);
  return json({ entry });
});

route('POST', /\/messages\/([^/]+)\/reply-variants$/, () =>
  delay(
    json({
      variants: [
        variant('v-new1', 'Warmer', 'Thanks so much for the quick turnaround — signing this afternoon.'),
        variant('v-new2', 'Direct', 'Signing now, will send back within the hour.'),
      ],
    }),
    700,
  ),
);
route('POST', /\/reply-variants\/[^/]+\/send$/, () =>
  json({ queued: true, entry: outboxEntry('femi@northwind.co', 'Re: Northwind retainer') }),
);

route('POST', /\/digest\/groups\/[^/]+\/queue$/, () =>
  json({ pending: { ...pendingActions[0], id: `p-${Math.random().toString(36).slice(2, 6)}` } }),
);
route('POST', /\/pending-actions\/[^/]+\/apply$/, () => json({ action: { ...pendingActions[0], state: 'applied' } }));
route('POST', /\/pending-actions\/[^/]+\/dismiss$/, () => json({ action: { ...pendingActions[0], state: 'dismissed' } }));
route('POST', /\/priority-feedback$/, (_m, init) => {
  const body = readBody(init);
  return json({ sender: String(body.sender ?? ''), level: String(body.level ?? '') });
});
route('POST', /\/followups\/[^/]+\/dismiss$/, () => json({ followup: { ...followups[0], state: 'dismissed' } }));
route('POST', /\/highlights\/[^/]+\/dismiss$/, (_m, init) => {
  const messageId = decodeURIComponent(String(_m[0]).match(/\/highlights\/([^/]+)\/dismiss$/)?.[1] ?? '');
  return json({ messageId, dismissed: true });
});

route('POST', /\/improve-text$/, (_m, init) => {
  const body = readBody(init);
  return delay(json({ text: `${String(body.text ?? '')}\n\n(polished by the preview harness)` }), 600);
});
route('POST', /\/suggest-subject$/, () => delay(json({ subject: 'Quick question about the retainer' }), 500));
route('POST', /\/draft-reply$/, () =>
  delay(
    json({
      draft: {
        accountId: 'acc-personal',
        threadId: 't-contract',
        to: 'femi@northwind.co',
        subject: 'Re: Northwind retainer',
        body: 'Hi Femi,\n\nSigning this now — you will have it back within the hour.\n\nAlex',
      },
    }),
    700,
  ),
);
route('GET', /\/drafts$/, () => json({ drafts: [] }));
route('POST', /\/drafts$/, (_m, init) => {
  const body = readBody(init);
  return json({ draft: { id: 'd-1', ...body } });
});
route('DELETE', /\/drafts\//, () => json({ ok: true }));

route('GET', /\/automations$/, () => json({ rules: [] }));
route('POST', /\/automations$/, (_m, init) => json({ rule: { id: 'r-1', ...readBody(init) } }));
route('PUT', /\/automations\/[^/]+$/, (_m, init) => json({ rule: { id: 'r-1', ...readBody(init) } }));
route('DELETE', /\/automations\/[^/]+$/, () => json({ ok: true }));
route('GET', /\/automations\/[^/]+\/runs$/, () => json({ runs: [] }));
route('POST', /\/automations\/dry-run$/, () => json({ days: 7, total: 214, matched: 14, sample: [] }));

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!raw.includes('/api/email/')) return realFetch(input as RequestInfo, init);

  const url = new URL(raw, location.origin);
  const path = url.pathname.replace(/^.*\/api\/email/, '');
  const method = (init?.method ?? 'GET').toUpperCase();

  for (const entry of routes) {
    if (entry.method !== method) continue;
    const m = path.match(entry.re);
    if (m) return entry.handler(m, init, url);
  }

  console.warn('[email-preview] unmatched', method, path);
  return json({ ok: true });
};

// ---------------------------------------------------------------------------
// SSE stub — a controllable emitter (window.__previewSSE.emit(type, payload))
// ---------------------------------------------------------------------------

class PreviewEventSource {
  static instances = new Set<PreviewEventSource>();
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  constructor(_url: string) {
    PreviewEventSource.instances.add(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  dispatch(type: string, payload: Record<string, unknown>): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const event = new MessageEvent(type, { data: JSON.stringify({ type, ...payload }) });
    for (const fn of set) fn(event);
  }
  close(): void {
    PreviewEventSource.instances.delete(this);
  }
}
(window as unknown as { EventSource: unknown }).EventSource = PreviewEventSource;
(window as unknown as { __previewSSE: unknown }).__previewSSE = {
  emit(type: string, payload: Record<string, unknown> = {}) {
    for (const i of PreviewEventSource.instances) i.dispatch(type, payload);
  },
};

// ---------------------------------------------------------------------------
// Scene mounting
// ---------------------------------------------------------------------------

window.__MINNOW_SESSION_TOKEN__ = 'preview';

function toast(state: 'ok' | 'err', message: string): void {
  const node = document.createElement('div');
  node.textContent = message;
  node.style.cssText = `position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;
    padding:8px 14px;border-radius:8px;font-size:13px;pointer-events:none;
    background:var(--mn-bg-elevated,#222);color:var(--mn-fg,#eee);
    border:1px solid ${state === 'err' ? 'var(--mn-danger,#c45)' : 'var(--mn-border,#444)'};
    box-shadow:0 8px 24px rgba(0,0,0,.3)`;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

const onStatus = (state: 'ok' | 'err', message: string): void => toast(state, message);

async function mountScene(): Promise<void> {
  const stage = document.getElementById('stage')!;
  stage.replaceChildren();
  const scene = new URLSearchParams(location.search).get('scene') ?? 'panel';

  if (scene === 'setup') {
    // Force the empty-account path by making /accounts return none.
    routes.unshift({ method: 'GET', re: /\/accounts$/, handler: () => json({ accounts: [] }) });
    await renderEmailPanel(stage, { onStatus });
    return;
  }
  if (scene === 'dashboard' || scene === 'error') {
    await renderEmailDashboard(stage, {
      account: accounts[0],
      onStatus,
      onOpenThread: (id) => toast('ok', `open thread ${id}`),
      onOpenMail: () => toast('ok', 'open mail'),
      onRefresh: () => void mountScene(),
    });
    return;
  }
  if (scene === 'mail') {
    await renderEmailLayout(stage, { account: accounts[0], onStatus });
    return;
  }
  if (scene === 'compose') {
    mountEmailCompose(stage, { account: accounts[0], mode: 'new', onStatus, onSent: () => toast('ok', 'sent') });
    return;
  }
  if (scene === 'automations') {
    await renderEmailAutomations(stage, { account: accounts[0], onStatus, onClose: () => toast('ok', 'close') });
    return;
  }
  if (scene === 'unified') {
    await renderUnifiedInbox(stage, {
      accounts,
      onStatus,
      onOpen: (message) => toast('ok', `open ${message.subject}`),
    });
    return;
  }
  // default: the full panel
  await renderEmailPanel(stage, { onStatus });
}

void mountScene();
