# Google OAuth setup for Minnow Email and Calendar

Minnow uses **your own** Google Cloud OAuth client (BYO). Credentials are stored in `~/.minnow/config.json` under `oauth.google` and encrypted tokens live under `~/.minnow/oauth/`.

## 1. Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.

## 2. Enable APIs

In **APIs & Services → Library**, enable:

- **Gmail API**
- **Google Calendar API**

## 3. Configure OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** (or Internal for Workspace-only testing).
3. Add your email as a test user while the app is in **Testing** mode.

## 4. Create OAuth client ID

1. Go to **APIs & Services → Credentials**.
2. **Create credentials → OAuth client ID**.
3. Application type: **Web application** (loopback redirect).
4. Add **Authorized redirect URI** — copy the exact value from **Settings → OAuth** in Minnow (typically `http://localhost:5173/api/oauth/callback`).
5. Copy **Client ID** and **Client secret** into **Settings → OAuth**.

## 5. Connect in Minnow

1. Start Minnow with `npm start`.
2. Open **Email** or **Calendar**.
3. Click **Sign in with Google** and complete consent in the browser tab.
4. Return to Minnow — the account should appear within a few seconds.

## Scopes

Minnow requests Gmail modify + Calendar access so it can read, triage, send (with confirmation), and sync events.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `redirect_uri_mismatch` | Redirect URI in Google Console must match Settings → OAuth exactly (port included). |
| `access_denied` | Add your Google account as a test user on the consent screen. |
| App in production verification | Stay in Testing mode for personal use, or complete Google verification for public use. |
