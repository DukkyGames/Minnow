# Odysseus Port 06 — Outgoing Webhooks

Tier: 2  
Effort: S-M  
Priority: Medium  
Status: Shipped  
Depends on: #12  
Linear: [MIN-118](https://linear.app/minnowai/issue/MIN-118/odysseus-port-06-outgoing-webhooks)

## Goal

Add HMAC-signed outgoing webhooks for Minnow events such as chat completion, session creation, and scheduler completion. This enables local-first automation without requiring a third-party event bus.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#12** (signing secrets encrypted at rest) |
| npm packages | None (stdlib `crypto`, `dns`, `http`/`https`) |
| External binaries | None |
| Test endpoint | Public HTTPS webhook tester (e.g. webhook.site) for manual QA |
| Estimated effort | 3–4 days |

## Prerequisites & Deliverables

| Deliverable | Description |
|-------------|-------------|
| `server/webhooks/` module | Store, SSRF guard, signing, delivery queue |
| CRUD API | Subscription management |
| Event emitters | `chat.completed`, `scheduler.job_completed` |
| Settings UI | New `webhooks` section |
| Tests | SSRF, signing, delivery retry |

## Verified Source Context

- Odysseus reference: `src/webhook_manager.py`.
  - `validate_webhook_url()`, `WebhookManager.fire()`, `fire_and_forget()`.
  - HMAC header `X-Odysseus-Signature`; allowed events list.
  - SSRF: DNS resolve + private IP check at validate and delivery time.
- Minnow generation completion: `server/generations/store.js` → `markComplete()`.
- Session creation: client-side `src/state/sessions.ts` — needs client bridge or config write hook.
- Middleware registration: `server/runtime/middlewares.js`.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/webhooks/store.js` | `~/.minnow/webhooks.json` subscriptions |
| `server/webhooks/sign.js` | HMAC-SHA256 signing |
| `server/webhooks/ssrf.js` | URL + DNS/IP validation |
| `server/webhooks/emit.js` | Delivery queue, retry, log |
| `server/webhooks/middleware.js` | CRUD + test-fire routes |
| `src/ui/settings-webhooks.ts` | Settings UI |
| `test/webhooks/ssrf.test.mjs` | Private IP, localhost, DNS rebinding |
| `test/webhooks/sign.test.mjs` | Fixed secret/payload signatures |
| `test/webhooks/delivery.test.mjs` | Retry, timeout, fire-and-forget |

## Files to Modify

| Path | Change |
|------|--------|
| `server/generations/store.js` | Emit `chat.completed` near `markComplete()` |
| `server/runtime/middlewares.js` | Register webhooks middleware |
| `src/ui/settings-page-types.ts` | Add `'webhooks'` to `SettingsSectionId` |
| `src/ui/settings-sections.ts` | Nav group + `refreshSettingsSection` case |
| `index.html` | `#settings-webhooks` section markup |
| `documentation/context.md` | Document webhook events and headers |

## Data Model

### Subscription (`~/.minnow/webhooks.json`)

```ts
interface WebhookSubscription {
  id: string;
  label: string;
  url: string;
  events: string[];  // subset of ALLOWED_EVENTS
  enabled: boolean;
  secretRef: string; // path or id into encrypted secret store (#12)
  createdAt: string;
  updatedAt: string;
}
```

### Delivery log (bounded, in-memory + `~/.minnow/webhooks-deliveries.json`)

```ts
interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: string;
  statusCode?: number;
  error?: string; // sanitized, no body
  durationMs: number;
  attemptedAt: string;
}
```

### Allowed events (v1)

```js
const ALLOWED_EVENTS = [
  'chat.completed',
  'session.created',      // if reliable hook exists
  'scheduler.job_completed', // after #5
  'webhook.test',
];
// Defer: 'chat.message' — needs per-message hook
```

## API Routes

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/webhooks/subscriptions` | Redact secret presence only (`hasSecret: true`) |
| POST | `/api/webhooks/subscriptions` | Validate URL via SSRF before save |
| PUT | `/api/webhooks/subscriptions/:id` | |
| DELETE | `/api/webhooks/subscriptions/:id` | |
| POST | `/api/webhooks/subscriptions/:id/test` | Fire `webhook.test` event |
| GET | `/api/webhooks/deliveries` | Recent delivery log (redacted) |

## Signing contract

Headers:

```
X-Minnow-Event: chat.completed
X-Minnow-Delivery: <uuid>
X-Minnow-Timestamp: <unix-seconds>
X-Minnow-Signature: sha256=<hex-hmac>
```

Signature payload: `{timestamp}.{rawJsonBody}`

Body:

```json
{
  "event": "chat.completed",
  "timestamp": "2026-06-12T10:00:00.000Z",
  "data": {
    "generationId": "...",
    "providerId": "...",
    "modelId": "...",
    "status": "completed",
    "chatId": "..."
  }
}
```

Do not include prompt text in webhook payloads by default.

## Detailed Implementation Phases

### Phase 1 — Subscription CRUD (1 day)

1. `server/webhooks/store.js` — atomic JSON persistence.
2. `server/webhooks/middleware.js` — CRUD routes.
3. Secret storage: on create/update, encrypt signing secret via #12 `writeEncryptedJsonFile` or dedicated `~/.minnow/webhooks/secrets/<id>.json`.
4. API responses: `hasSecret: boolean`, never raw secret.
5. Register middleware.

### Phase 2 — SSRF guard (1 day)

1. `server/webhooks/ssrf.js` — port Odysseus `validate_webhook_url()`:
   - Allow `https:` only in production; optional `http://127.0.0.1` for dev behind explicit config flag.
   - Reject: localhost hostnames, private IPv4 ranges, link-local, multicast, IPv6 unique-local.
   - `dns.promises.resolve()` → validate **all** returned addresses.
   - Re-check DNS at delivery time (rebinding defense).
2. `sanitize_error()` — strip IPv6 literals from error messages (port Odysseus test).
3. Tests: `127.0.0.1`, `localhost`, `10.0.0.1`, `169.254.x.x`, valid public HTTPS.

### Phase 3 — Signing and delivery (1 day)

1. `server/webhooks/sign.js` — HMAC-SHA256 with secret from #12.
2. `server/webhooks/emit.js`:
   - `fireAndForget(event, data)` — enqueue, return immediately.
   - Bounded queue (max 100 pending); drop oldest on overflow with warning.
   - Per-delivery timeout: 10s.
   - Retry: 3 attempts, exponential backoff (1s, 4s, 16s).
   - Worker loop: async, does not block generation completion.
3. Tests: fixed secret + payload → expected signature; timeout does not stall caller.

### Phase 4 — Event sources (0.5 day)

1. **`chat.completed`:** Hook in `server/generations/store.js` → `markComplete()`:
   - Capture generation id, provider, model, status, chatId, timestamps **before** state eviction.
   - Call `fireAndForget('chat.completed', data)`.
2. **`session.created`:** Option A — client calls `POST /api/webhooks/events/session-created` after new chat. Option B — diff in sessions config write path. Pick one; document.
3. **`scheduler.job_completed`:** Hook in #5 `runner.js` on job finish.
4. Defer `chat.message` unless explicit session-save hook is added.

### Phase 5 — Settings UI (0.5 day)

1. Add `'webhooks'` to `SettingsSectionId` under integrations nav group.
2. `src/ui/settings-webhooks.ts`:
   - Subscription list with enabled toggle.
   - Add/edit: label, URL, event checkboxes, secret input.
   - Test-fire button → shows latest delivery status.
   - Recent deliveries table: time, event, status code, redacted error.
3. Wire `index.html` section + `refreshSettingsSection('webhooks')`.

## Implementation TODOs

- [x] Add webhook store and CRUD routes
- [x] Add secret storage integration for signing secrets
- [x] Add SSRF guard that checks URL scheme, hostname, and resolved IPs
- [x] Add HMAC signing headers
- [x] Add bounded delivery queue and recent delivery log
- [x] Add `chat.completed` event emission
- [x] Add `session.created` event emission if a reliable hook exists
- [x] Add Settings UI for subscriptions, events, test-fire, and delivery log
- [x] Add a `webhooks` `SettingsSectionId`, nav group entry, `index.html` section markup, and `refreshSettingsSection()` case
- [x] Update `documentation/context.md`

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_webhook_ssrf_resilience.py` | `test/webhooks/ssrf.test.mjs` |
| `tests/test_webhook_sanitize_error_ipv6.py` | sign/delivery error sanitization |

## Acceptance Criteria

- A public HTTPS test endpoint receives signed JSON.
- Invalid/private URLs are rejected before save or delivery.
- Completing a chat emits `chat.completed`.
- Test-fire works from Settings.
- Slow endpoints cannot stall chat completion.
- Full secrets are never logged or returned.

## Verification

- Add SSRF unit tests for private IPv4/IPv6, localhost hostnames, DNS-resolved private ranges, and valid public HTTPS
- Add signing tests with fixed secret and payload
- Manual: send to a webhook test endpoint and verify HMAC
- Manual: attempt `127.0.0.1`, `localhost`, and private LAN URLs and confirm rejection

## Risks And Guardrails

- SSRF is the critical security risk; do not ship without DNS/IP validation.
- Delivery must be fire-and-forget from user-facing completions.
- Do not log request bodies if they may contain prompt data.
- Secrets depend on #12.
