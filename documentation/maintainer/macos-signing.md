# macOS release signing & notarization

Signed + notarized macOS builds are required for:

- **Gatekeeper** — users can open the `.dmg` without right-click → Open workarounds
- **Auto-update** — packaged macOS installs only enable `electron-updater` when the running app carries a **Developer ID Application** signature (see [`electron/updater.ts`](../../electron/updater.ts))

Windows releases can stay unsigned for now; this guide is macOS-only.

---

## Quick status check

```bash
npm run signing:check
```

Exit `0` = ready to run `npm run package:mac` with signing + notarization.  
Exit `1` = something is missing (certificate and/or Apple notarization credentials).

---

## One-time setup

### 1. Developer ID Application certificate

You need a **Developer ID Application** cert in your **login** keychain (not just an Apple ID sign-in).

**Option A — Xcode (fastest if you already use Xcode)**

1. Xcode → **Settings** → **Accounts** → select your team
2. **Manage Certificates…** → **+** → **Developer ID Application**
3. Re-run `npm run signing:check`

**Option B — Apple Developer portal + CSR**

```bash
npm run signing:setup
```

This writes a CSR to `build/macos-signing/developer_id.csr` (gitignored). Then:

1. [Certificates](https://developer.apple.com/account/resources/certificates/list) → **+**
2. **Developer ID Application** → upload the CSR
3. Download the `.cer` and double-click to install
4. `npm run signing:check`

### 2. Notarization credentials

Copy the template and fill in your values:

```bash
cp .env.signing.example .env.signing
```

**Option A — Apple ID + app-specific password** (simple for local releases)

| Variable | Value |
|----------|-------|
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | From [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-character team id (Developer portal → Membership, or Xcode → Accounts) |

**Option B — App Store Connect API key** (better for CI)

Set `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_KEY_ISSUER` in `.env.signing` instead.

`.env.signing` is gitignored — never commit it.

### 3. Verify

```bash
npm run signing:check
```

You should see ✓ for the certificate, `.env.signing`, and notarization credentials.

---

## Building a signed release

```bash
npm run package:mac
```

[`scripts/electron-builder-run.mjs`](../../scripts/electron-builder-run.mjs) loads `.env.signing`, picks the first **Developer ID Application** identity in your keychain (override with `CSC_NAME` — use the name only, e.g. `Grim Media (TEAMID)`, not the `Developer ID Application:` prefix), signs with hardened runtime + entitlements in [`build/entitlements.mac.plist`](../../build/entitlements.mac.plist), and notarizes when credentials are present.

Output lands in `release/pkg/`:

| Artifact | Role |
|----------|------|
| `Minnow-<version>-<arch>.dmg` | User download |
| `Minnow-<version>-<arch>.zip` | Auto-update payload |
| `latest-mac.yml` | macOS update feed (attach to GitHub Releases with the zip) |

### Unsigned local build (debug only)

```bash
MINNOW_SKIP_SIGNING=1 npm run package:mac
```

Gatekeeper will block first open; auto-update stays disabled in Settings.

---

## GitHub release checklist (macOS)

```
[ ] Bumped version in package.json
[ ] npm run signing:check passes
[ ] npm run package:mac succeeded
[ ] release/pkg/ has .dmg, .zip, latest-mac.yml (+ .blockmap if present)
[ ] GitHub release tagged v<version>
[ ] Attach macOS artifacts + latest-mac.yml
[ ] Release notes written for users
[ ] Pre-release flag set correctly (Beta vs Stable)
```

See also [`updating.md`](releasing.md) for the shared release flow.

---

## Entitlements

| File | Used for |
|------|----------|
| [`build/entitlements.mac.plist`](../../build/entitlements.mac.plist) | Main app — JIT, native modules (`node-pty`, `better-sqlite3`), mic/camera for browser preview |
| [`build/entitlements.mac.inherit.plist`](../../build/entitlements.mac.inherit.plist) | Helper / child processes |

If notarization fails with an entitlement error, adjust these plists and rebuild.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `0 valid identities found` | Create/install **Developer ID Application** (not “Apple Development”) |
| `Please remove prefix "Developer ID Application:"` | Fixed automatically by [`macos-signing-env.mjs`](../../scripts/macos-signing-env.mjs); if you set `CSC_NAME` manually, omit the prefix |
| Notarization fails immediately | Check `.env.signing`; team id must match the signing cert |
| App opens but updater disabled | Build was unsigned or ad-hoc — use a signed `package:mac` build |
| `node-pty` / native module crash on launch | Ensure `com.apple.security.cs.disable-library-validation` is in both entitlements files |
| Want CI signing later | Use App Store Connect API key env vars; store secrets in GitHub Actions |
