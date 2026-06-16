# OAuth for Email and Calendar (shipped)

One-click **Sign in with Google** / **Sign in with Microsoft** for Email and Calendar account connect. Not app-wide user login.

## Architecture

- Shared server module: [`server/oauth/`](../../server/oauth/)
- Encrypted tokens: `~/.minnow/oauth/secrets/`
- BYO credentials: `config.json` → `oauth.google` / `oauth.microsoft` (Settings → OAuth)
- Email backends: [`server/email/transport.js`](../../server/email/transport.js) → IMAP (password) | Gmail API | Graph mail
- Calendar backends: [`server/calendar/sync-backend.js`](../../server/calendar/sync-backend.js) → CalDAV | Google Calendar API | Graph calendar
- UI: [`src/ui/oauth-connect.ts`](../../src/ui/oauth-connect.ts)

## Setup guides

- [Google](../../guides/oauth-google.md)
- [Microsoft](../../guides/oauth-microsoft.md)

## Tests

```bash
npm run test:oauth
npm run test:email
npm run test:calendar
```

## API

| Route | Purpose |
|-------|---------|
| `GET /api/oauth/ping` | Health + redirect URI |
| `GET /api/oauth/config` | Redacted credential status |
| `POST /api/oauth/start` | Begin PKCE flow |
| `GET /api/oauth/callback` | Provider redirect handler |
| `GET /api/oauth/connections` | List linked accounts |
| `DELETE /api/oauth/connections/:id` | Disconnect + remove provisioned accounts |

Redirect URI: `http://localhost:{port}/api/oauth/callback` (override with `MINNOW_OAUTH_REDIRECT_BASE`).
