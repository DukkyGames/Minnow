# Odysseus Port 12 — Encrypted Credential Storage

Tier: 4  
Effort: M  
Priority: Safety prerequisite  
Status: Planned  
Linear: [MIN-117](https://linear.app/minnowai/issue/MIN-117/odysseus-port-12-encrypted-credential-storage)

## Goal

Encrypt Minnow credentials at rest before adding webhook, email, calendar, voice, image, and remote model credentials. Existing provider secrets are currently stored as plaintext JSON under `~/.minnow/providers/<id>/secrets.json` with restrictive permissions only.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | None (ship before #6, #7, #9, #10, #11) |
| npm packages | None for file-key v1; optional `keytar` or `@napi-rs/keyring` for OS keychain phase |
| External binaries | None |
| Credentials | None |
| Runtime | Must work in standalone `npm start`, Electron desktop, and `minnow run` |
| Estimated effort | 2–3 days |

## Prerequisites & Deliverables

| Deliverable | Description |
|-------------|-------------|
| `server/security/secret-box.js` | AES-256-GCM encrypt/decrypt with versioned JSON envelope |
| Provider migration | Transparent encrypt-on-read for existing `secrets.json` |
| Shared helpers | `readEncryptedJsonFile` / `writeEncryptedJsonFile` for downstream plans |
| Tests | Round-trip, tamper, migration, provider auth still works |
| `context.md` update | Document encryption contract and key-loss warning |

## Verified Source Context

- Odysseus reference: `documentation/reference/odysseus-dev/odysseus-dev/src/secret_storage.py`.
  - Uses Fernet (`cryptography`); encrypted prefix `enc:`.
  - Key file: `data/.app_key`, mode `0o600`.
  - `encrypt()`, `decrypt()`, `is_encrypted()`; legacy plaintext passes through.
- Minnow provider secrets: `server/providers/store.js` → `readSecrets()`, `writeSecrets()`.
- Provider auth headers: `server/providers/auth-headers.js`.
- Config home helpers: `server/config/home.js`.
- Electron is available in the desktop build, but the Node server also runs standalone through `npm start`; encryption must work in both runtimes.

## Files to Create

| Path | Purpose |
|------|---------|
| `server/security/secret-box.js` | Core encrypt/decrypt + key management |
| `test/security/secret-box.test.mjs` | Unit tests |
| `test/security/secret-migration.test.mjs` | Plaintext → encrypted migration tests |

## Files to Modify

| Path | Change |
|------|--------|
| `server/providers/store.js` | Route `readSecrets`/`writeSecrets` through secret-box |
| `documentation/context.md` | Document encryption, key file location, key-loss warning |

## Target Architecture

Add `server/security/secret-box.js` with:

- `encryptSecretPayload(plaintext: string): Promise<object>`
- `decryptSecretPayload(box: object): Promise<string>`
- `isEncryptedSecretPayload(value: unknown): boolean`
- `loadSecretKeyMetadata(): Promise<object>`
- `readEncryptedJsonFile(path, defaults): Promise<object>` (optional shared helper)
- `writeEncryptedJsonFile(path, value): Promise<void>` (optional shared helper)

Use AES-256-GCM with random IVs and authentication tags. The server runs in standalone Node as well as inside Electron, so it cannot directly assume Electron `safeStorage` is available.

### Key strategy (decide in Phase 1)

| Strategy | Pros | Cons |
|----------|------|------|
| **File key (v1 recommended)** | Works everywhere (`npm start`, Electron, CLI) | Key file theft = secret exposure |
| Node keychain (`keytar` / `@napi-rs/keyring`) | OS-protected | Windows packaging complexity; fallback still needed |
| Electron IPC `safeStorage` | Native OS encryption | Unavailable in standalone server |

Record `keySource` in encrypted payload metadata so decrypt path can choose the right backend.

### Encrypted JSON envelope

```json
{
  "version": 1,
  "encrypted": true,
  "keySource": "file",
  "algorithm": "aes-256-gcm",
  "iv": "<base64>",
  "tag": "<base64>",
  "ciphertext": "<base64>"
}
```

Plaintext legacy `secrets.json` shape (unchanged semantics):

```json
{
  "apiKey": "...",
  "bearer": "..."
}
```

After migration, the file contains the envelope JSON (entire file is the box, or box wraps a JSON string of secrets — pick one and document).

## Detailed Implementation Phases

### Phase 1 — Key management (0.5 day)

1. Create `server/security/secret-box.js`.
2. Implement file-key path:
   - Key path: `~/.minnow/.key` (use `getMinnowHome()` from `server/config/home.js`).
   - On first use: `crypto.randomBytes(32)` → base64 → write with `0o600`.
   - On read: fail closed if missing, unreadable, or wrong length.
3. Record `keySource: "file"` in all encrypted payloads.
4. Document key-loss behavior: encrypted secrets become unrecoverable; user must re-enter credentials.

### Phase 2 — AES-GCM helpers (0.5 day)

1. `encryptSecretPayload(plaintext)`:
   - Generate 12-byte random IV (`crypto.randomBytes(12)`).
   - `crypto.createCipheriv('aes-256-gcm', key, iv)`.
   - Optionally bind AAD: `version|keySource|algorithm` string.
   - Return envelope object with base64-encoded `iv`, `tag`, `ciphertext`.
2. `decryptSecretPayload(box)`:
   - Validate `version`, `algorithm`, required fields.
   - `crypto.createDecipheriv` + `setAuthTag`; throw on tamper.
3. `isEncryptedSecretPayload(value)`:
   - True when `value?.encrypted === true && value?.version === 1`.
4. Never log plaintext, ciphertext, keys, or decrypted values.

### Phase 3 — Provider integration (1 day)

1. Modify `server/providers/store.js`:
   - `readSecrets(providerId)`:
     - Read `~/.minnow/providers/<id>/secrets.json`.
     - If `isEncryptedSecretPayload(raw)`, decrypt → `JSON.parse`.
     - If plaintext object (legacy), parse and **immediately rewrite encrypted** (migration).
     - Return parsed secrets object (same shape as today).
   - `writeSecrets(providerId, secrets)`:
     - `JSON.stringify(secrets)` → encrypt → atomic write (temp + rename).
     - Call existing `chmodSecrets()` after write.
2. Preserve `secretsFlags()` redaction for API responses (`hasApiKey`, `hasBearer`).
3. Ensure interrupted migration cannot delete last readable file:
   - Write to `secrets.json.tmp`, fsync, rename over original only after verify.

### Phase 4 — Downstream API prep (0.5 day)

1. Export generic helpers if they reduce duplication:
   - `readEncryptedJsonFile(path, defaults)` — decrypt or return defaults.
   - `writeEncryptedJsonFile(path, value)` — encrypt + atomic write.
2. Document usage contract for plans #6, #7, #9, #10, #11:
   - Webhook signing secrets: `secretRef` → encrypted file or inline encrypted field.
   - Email/CalDAV passwords: encrypted via same box.
   - STT/TTS/image provider keys: reuse provider secrets or dedicated encrypted files.

### Phase 5 — Tests and manual QA (0.5 day)

1. `test/security/secret-box.test.mjs`:
   - Round-trip encrypt/decrypt.
   - Tamper: flip one ciphertext byte → decrypt throws.
   - Wrong key: use different key fixture → decrypt fails.
   - Malformed envelope: missing fields → clear error.
   - `isEncryptedSecretPayload` true/false cases.
2. `test/security/secret-migration.test.mjs`:
   - Write plaintext fixture → read → file rewritten encrypted → auth headers still work.
3. Manual: corrupt tag byte → provider shows auth error without leaking secret.

## Implementation TODOs

- [ ] Add `server/security/secret-box.js`
- [ ] Add tests for round-trip, tamper detection, wrong-key failure, malformed payload failure, and plaintext detection
- [ ] Wrap provider `readSecrets()` and `writeSecrets()` in `server/providers/store.js`
- [ ] Keep `readSecrets()` and `writeSecrets()` private to provider code, but route their implementation through `server/security/secret-box.js`
- [ ] Add transparent migration when plaintext `secrets.json` is read
- [ ] Preserve redacted public provider flags through `secretsFlags()`
- [ ] Export helper functions for downstream stores, including webhooks, email, calendar, STT/TTS, and image providers
- [ ] Update provider and config docs in `documentation/context.md`
- [ ] Add Settings warning copy when credential features are enabled (key-loss notice)

## Odysseus Tests to Port

| Odysseus test file | Minnow target |
|--------------------|---------------|
| `tests/test_security_regressions.py` (`test_secret_storage_*`) | `test/security/secret-box.test.mjs` |
| `tests/test_email_polly_imap_leak.py` | Deferred to #9 — verify no password in API |
| `tests/test_cookbook_hf_token.py` | Deferred to #2 — HF token via secret-box |

## Acceptance Criteria

- Existing plaintext provider secrets migrate to encrypted JSON on the next read.
- Provider auth still works after migration.
- Tampering with ciphertext or tag causes decrypt to fail closed.
- Missing secret files still return the existing empty secret defaults.
- No decrypted secret appears in logs, errors, or API responses.
- Encryption works in standalone `npm start`, Electron desktop, and `minnow run`.

## Verification

- Run `node --test test/security/secret-box.test.mjs`.
- Run `node --test test/providers/*.test.js test/providers/*.test.mts`.
- Manually create a plaintext `secrets.json`, start Minnow, fetch providers, and confirm the file is rewritten encrypted while `hasApiKey` / `hasBearer` still works.
- Corrupt one byte in an encrypted fixture and confirm provider auth fails with a clear non-secret error.
- Verify the chosen key source works in standalone `npm start`, Electron desktop, and `minnow run`.

## Risks And Guardrails

- Key loss makes encrypted secrets unrecoverable. Document this in Settings when credential features are added.
- `safeStorage` may not be reachable from the standalone Node server; the file-key fallback is required.
- Do not block #13 on this plan. Prompt-injection tagging can ship first.
- Do not encrypt non-secret config such as provider labels, base URLs, or model paths.
