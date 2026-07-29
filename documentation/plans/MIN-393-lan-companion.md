# MIN-393 — authenticated LAN companion

## Goal

Make Minnow reachable from a phone or tablet on the same private network without exposing the host session credential. A host user creates a short-lived QR pairing link, the companion exchanges it once for a named device token, and the host can revoke that token immediately.

## Constraints

- The per-boot host token remains the local Electron, browser, and CLI credential.
- A LAN navigation must never receive the host token in HTML.
- Device secrets are shown once, stored only as SHA-256 hashes on the host, and kept in browser storage on the paired device.
- Pairing remains same-origin and LAN-only. No CORS headers are added.
- Plain LAN HTTP is not a secure context, so browsers cannot run the service worker. The shell remains responsive and reconnectable, but offline installation requires a future HTTPS transport.
- Calendar and Email remain omitted while their developer release gates are `hidden`.
- Terminal, browser automation, Code, Models, Brain, Issues, Research, and Settings are not companion destinations.

## Architecture

### Authentication

1. The host session requests `POST /api/auth/pairings` with a device label.
2. The server creates a random, single-use, five-minute pairing secret and returns companion URLs with `#pair=<secret>`.
3. A LAN browser loads the public SPA shell without an injected host token.
4. Before normal app bootstrap, the browser exchanges the fragment through `POST /api/auth/pair`.
5. The server returns a random device token. The browser stores it in `localStorage`, removes the fragment, and continues to the authenticated shell.
6. The global API interceptor and URL-token helper use the host token when injected, otherwise the stored device token.
7. The central auth middleware accepts either the per-boot host token or an active device-token hash.

Device records live in `~/.minnow/auth/devices.json` with restrictive permissions. Pairing challenges are memory-only and disappear on restart.

### Companion shell

Narrow, non-Electron devices render a dedicated shell at `#/companion`:

- Chat is the primary destination and reuses the existing Chat app.
- Notifications and Scheduler are reachable from compact navigation.
- Calendar and Email destinations are added only when their existing release gates allow them.
- Desktop-only apps and browser/terminal controls are absent.
- The shell displays a blocking pairing screen until a valid device session exists.
- A global reconnect banner probes the authenticated ping endpoint on browser online/offline, visibility, and periodic events.

### Approval provenance

The authenticated request records device identity on the incoming request. Destructive tool execution remains in the requesting browser's existing approval queue; companion navigation never exposes desktop-only tool surfaces.

## Security decisions

- Pairing exchange is the only unauthenticated API operation. Host validation, LAN client checks, TTL, one-time consumption, and attempt throttling still apply.
- Device tokens use a stable id plus a 256-bit secret. Only the hash is persisted.
- Revocation removes the record synchronously before the API responds, so the next request receives `401`.
- Management routes require the host per-boot token. Device tokens cannot enumerate, create, rename, or revoke devices.
- Query tokens remain supported for EventSource/WebSocket compatibility. Application logs must not print request URLs containing tokens.

## Todos

- [x] Prevent host token disclosure in LAN-served HTML.
- [x] Add device-token storage, one-time pairing challenges, throttling, and auth routes.
- [x] Extend central HTTP and WebSocket authentication to active device tokens.
- [x] Add client token storage and pre-bootstrap pairing exchange.
- [x] Add QR pairing and device revoke controls to Settings → Network.
- [x] Add the narrow companion shell and hide desktop-only destinations.
- [x] Add host reconnect feedback and service-worker secure-context guidance.
- [x] Cover token lifecycle, pairing, authorization boundaries, and revocation with automated tests.
- [x] Validate at a 375px viewport and run typecheck/build.
- [x] Update `documentation/context.md` and LAN setup guidance.

## Acceptance mapping

| Requirement | Validation |
|---|---|
| Named, revocable phone token | Pairing API tests plus Settings/device-list manual flow |
| Streaming and resume | Existing generations replay path under device-token middleware plus mobile Chat walkthrough |
| Companion destinations at 375px | Responsive manual walkthrough; hidden apps remain gated |
| No API without a valid token | Extended MIN-381 middleware/integration tests |
| Desktop-only surfaces hidden | Companion navigation unit/DOM assertions and walkthrough |

