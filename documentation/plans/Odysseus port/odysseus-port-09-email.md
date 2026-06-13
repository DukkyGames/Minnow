# Odysseus Port 09 — Email Integration

Tier: 3  
Effort: XL  
Priority: Later  
Status: Planned  
Depends on: #12 and #13  
Recommended scope: read-only triage first  
Linear: [MIN-126](https://linear.app/minnowai/issue/MIN-126/odysseus-port-09-email-integration)

## Goal

Add a local-first email surface with IMAP fetch, AI triage, and later SMTP draft/send support. The first version must be read-only so credential, trust, pagination, and untrusted-content handling are correct before sending email is introduced.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#12** (IMAP/SMTP passwords), **#13** (wrap bodies before LLM triage) |
| npm packages | `imapflow` or `node-imap` for IMAP; `nodemailer` for SMTP (later phase) |
| Test mailbox | Dedicated IMAP test account (Gmail app password, Fastmail, or Mailhog) |
| Outlook caveat | v1 is IMAP/SMTP basic auth — many Outlook tenants block this; document Graph/OAuth as future |
| Estimated effort | 12–18 days (read-only + triage); +5 days for SMTP send |

## Prerequisites & Deliverables

| Phase | Deliverable |
|-------|-------------|
| P1 | Encrypted account config + connection test |
| P2 | Read-only IMAP fetch + thread normalization + cache |
| P3 | Email MinnowOS app (inbox, thread view) |
| P4 | AI triage (summary, tags, urgency) with #13 wrapping |
| P5 | Background polling (opt-in per account) |
| P6 | Agent tools: `list_mail`, `draft_reply` |
| P7 | SMTP send with explicit user confirmation |

## Verified Source Context

- Odysseus references:
  - `routes/email_routes.py`, `routes/email_helpers.py`, `routes/email_pollers.py`
  - `src/email_thread_parser.py`
  - `docs/email-outlook.md`
  - `mcp_servers/email_server.py`
- Minnow document parsing: `server/tools/read-document.js`.
- Tool definitions: `src/tools/definitions.ts`.
- Tool handlers: `server/runtime/tools-middleware.js`.
- MinnowOS: add `email` to `src/os/types.ts`.

## Files to Create

### Server

| Path | Purpose |
|------|---------|
| `server/email/accounts.js` | Account CRUD, encrypted creds via #12 |
| `server/email/imap.js` | IMAP connect, folder list, fetch |
| `server/email/threads.js` | Thread normalization |
| `server/email/cache.js` | `~/.minnow/email/cache/<accountId>/` |
| `server/email/triage.js` | LLM summary/tags/urgency |
| `server/email/poller.js` | Interval sync loop |
| `server/email/attachments.js` | Metadata + optional text extract |
| `server/email/smtp.js` | Draft/send (P7) |
| `server/email/middleware.js` | `/api/email` routes |

### Client

| Path | Purpose |
|------|---------|
| `src/ui/email-page.ts` | Full Email app UI |
| `src/styles/email.css` | Styles |
| `src/email/client.ts` | API client |

### Tests

| Path | Purpose |
|------|---------|
| `test/email/accounts.test.mjs` | Config validation |
| `test/email/thread-parser.test.mjs` | Fixed MIME fixtures |
| `test/email/triage-parse.test.mjs` | LLM JSON output parser |

## Files to Modify

| Path | Change |
|------|--------|
| `src/os/types.ts` | Add `'email'` to `AppId` |
| `src/os/app-registry.ts` | Register Email app |
| `src/os/app-host.ts` | Email layer wiring |
| `index.html` | `#emailView` |
| `server/runtime/middlewares.js` | Register email middleware |
| `src/tools/definitions.ts` | `list_mail`, `draft_reply` (P6) |
| `server/runtime/tools-middleware.js` | Tool handlers (P6) |
| `documentation/context.md` | Document email limitations |

## Data Model

### Account config (`~/.minnow/email/accounts.json` — passwords via #12)

```ts
interface EmailAccount {
  id: string;
  label: string;
  imap: { host: string; port: number; tls: boolean };
  smtp?: { host: string; port: number; starttls: boolean };
  username: string;
  secretRef: string;  // encrypted password via #12
  fromAddress?: string;
  isDefault: boolean;
  pollingEnabled: boolean;
  pollingIntervalMinutes: number;
  folders: string[];  // e.g. ['INBOX']
}
```

### Cached message (`~/.minnow/email/cache/<accountId>/messages.json`)

```ts
interface EmailMessage {
  uid: string;
  messageId: string;
  threadId: string;
  folder: string;
  from: string;
  to: string[];
  subject: string;
  date: string;
  bodyPreview: string;
  bodyHash: string;
  hasAttachments: boolean;
  triage?: { summary: string; tags: string[]; urgency: 'low' | 'normal' | 'high'; cachedAt: string };
}
```

## API Routes

| Method | Path | Phase |
|--------|------|-------|
| GET | `/api/email/accounts` | P1 |
| POST | `/api/email/accounts` | P1 |
| PUT | `/api/email/accounts/:id` | P1 |
| DELETE | `/api/email/accounts/:id` | P1 |
| POST | `/api/email/accounts/:id/test` | P1 — IMAP connection test |
| GET | `/api/email/accounts/:id/folders` | P2 |
| GET | `/api/email/accounts/:id/messages` | P2 — `?folder=&offset=&limit=` |
| GET | `/api/email/accounts/:id/threads/:threadId` | P2 |
| POST | `/api/email/accounts/:id/sync` | P2 — manual refresh |
| POST | `/api/email/messages/:id/triage` | P4 |
| POST | `/api/email/draft-reply` | P6 |
| POST | `/api/email/send` | P7 — explicit user action only |

## Detailed Implementation Phases

### Phase 1 — Account setup (2 days)

1. `server/email/accounts.js`:
   - CRUD with validation (host, port 1–65535, non-empty username).
   - Password via #12 `writeEncryptedJsonFile` — never in API responses.
   - `POST .../test`: IMAP connect + login + logout.
2. Document Outlook limitations (link to Odysseus `docs/email-outlook.md` intent).
3. Tests: validation rejects bad port; API never returns password.

### Phase 2 — Read-only IMAP (4 days)

1. `server/email/imap.js` using `imapflow`:
   - List folders.
   - Fetch recent messages with UID pagination (`limit` default 50).
   - Parse headers, plain/HTML body preview (strip HTML to text).
   - Thread grouping via `In-Reply-To` / `References` / subject normalization (`threads.js`).
2. `server/email/cache.js`:
   - Persist metadata for fast UI reload.
   - Store UID cursors per folder for incremental sync.
3. `server/email/attachments.js`:
   - List attachment filenames + sizes.
   - Optional: extract text via `read-document.js` for triage context.
4. Tests: fixed MIME fixtures → expected thread ids.

### Phase 3 — Email app UI (3 days)

1. Add `email` MinnowOS app (registry, host, `index.html` layer).
2. `src/ui/email-page.ts`:
   - Account setup wizard (first run).
   - Inbox list: subject, from, date, urgency badge, unread style.
   - Folder/account selector.
   - Thread view: message stack, body, attachments.
   - Manual refresh button.
   - Empty/error states: auth failure, no network, empty folder.
3. Source-contract tests for app registration.

### Phase 4 — AI triage (2 days)

1. `server/email/triage.js`:
   - **Hard gate:** wrap body with #13 `wrapUntrusted(text, { source: 'email' })` before LLM.
   - Utility-role LLM call (#4): strict JSON `{ summary, tags[], urgency }`.
   - Cache by `bodyHash` — skip re-triage if unchanged.
2. UI: show summary, tags, urgency in inbox + thread headers.
3. Tests: parser fixtures; verify wrapped content in prompt assembly.

### Phase 5 — Background polling (1 day)

1. `server/email/poller.js`:
   - Opt-in per account (`pollingEnabled`).
   - Default interval: 15 minutes; min 5 minutes.
   - Rate-limit large mailboxes; incremental UID fetch.
   - Start from `server/runtime/bootstrap.js` (like #5 scheduler).
2. UI: polling toggle + interval in account settings.

### Phase 6 — Agent tools (2 days)

1. `list_mail` in `definitions.ts` + `tools-middleware.js`:
   - Args: `accountId?`, `folder?`, `query?`, `limit` (max 20).
   - Returns bounded summaries + ids, not full mailbox dumps.
2. `draft_reply`:
   - Args: `threadId`, `instructions?`.
   - Returns draft text for user review — **does not send**.
3. Permission: `serverRequired: true`; respect tool permissions.

### Phase 7 — SMTP send (3 days)

1. `server/email/smtp.js` via `nodemailer`.
2. Draft composer UI in thread view.
3. Send button with confirmation modal.
4. Store sent metadata if IMAP Sent folder sync supported.
5. **No auto-send tool in v1.**

## Implementation TODOs

- [ ] Add email account encrypted config
- [ ] Add IMAP connection and folder listing
- [ ] Add paginated inbox fetch
- [ ] Add thread normalization
- [ ] Document IMAP/SMTP limitations, especially Outlook accounts that block basic auth
- [ ] Add Email MinnowOS app shell
- [ ] Add read-only thread UI
- [ ] Wrap email body content with #13 before LLM triage
- [ ] Add AI triage
- [ ] Add background polling and cache refresh
- [ ] Add `list_mail` tool
- [ ] Add draft reply flow
- [ ] Add SMTP send with explicit user action
- [ ] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_email_*.py` (13 files) | thread-parser, accounts |
| `tests/test_imap_*.py` | imap.js |
| `tests/test_email_polly_imap_leak.py` | no password in logs/API |

## Acceptance Criteria

- A test IMAP account can be added with encrypted credentials.
- Inbox and thread views render paginated messages.
- AI tags, urgency, and summaries appear for fetched messages.
- `list_mail` can return bounded recent summaries to an agent.
- `draft_reply` creates a draft but does not send automatically.
- SMTP send requires explicit user action.

## Verification

- Add account config validation tests
- Add IMAP parser/thread tests with fixed fixtures
- Add triage parser tests with fixed LLM JSON fixtures
- Manual: connect a test mailbox, fetch inbox, open a thread, and run triage
- Manual: draft a reply and send a test email only after explicit confirmation

## Risks And Guardrails

- Credentials depend on #12.
- Email bodies are untrusted prompt content and depend on #13.
- Background polling must be opt-in per account or clearly communicated.
- Large mailboxes require pagination and bounded sync.
- Never auto-send email.
- Avoid logging raw email bodies unless explicitly in debug fixtures.
