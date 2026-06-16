# Microsoft OAuth setup for Minnow Email and Calendar

Minnow uses **your own** Azure app registration. Credentials are stored in `~/.minnow/config.json` under `oauth.microsoft`. Access and refresh tokens are encrypted under `~/.minnow/oauth/`.

## 1. Register an application

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) or [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).
2. **New registration**.
3. Name: e.g. `Minnow Local`.
4. Supported account types:
   - **Personal Microsoft accounts only** for Outlook.com, or
   - **Accounts in any organizational directory and personal** for mixed use.
5. Redirect URI: **Web** — paste the URI from **Settings → OAuth** in Minnow (`http://localhost:5173/api/oauth/callback` or your dev port).

## 2. Create a client secret

1. Open the app → **Certificates & secrets**.
2. **New client secret** — copy the value immediately.
3. Paste **Application (client) ID** and secret into **Settings → OAuth**.

## 3. API permissions

Under **API permissions → Add a permission → Microsoft Graph → Delegated**:

- `openid`, `email`, `profile`, `offline_access`, `User.Read`
- `Mail.ReadWrite`, `Mail.Send`
- `Calendars.ReadWrite`

Grant admin consent if your tenant requires it (work/school accounts).

## 4. Tenant ID

- **Personal Outlook**: use `common` in Settings → OAuth (default).
- **Single-tenant work account**: use your Directory (tenant) ID from the app overview page.

## 5. Connect in Minnow

1. `npm start`
2. **Email** or **Calendar** → **Sign in with Microsoft**
3. Complete sign-in in the browser tab.

## Why Graph instead of IMAP passwords?

Microsoft disables basic auth for most Outlook and Microsoft 365 mailboxes. Minnow uses **Microsoft Graph** for OAuth mail and calendar sync.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `AADSTS50011` redirect URI mismatch | Match Azure redirect URI to Settings → OAuth exactly. |
| `Need admin approval` | Tenant admin must consent, or use a personal account. |
| Empty mail after connect | Confirm `Mail.ReadWrite` is granted and mailbox is licensed for Graph. |
