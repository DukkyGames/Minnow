# LAN network access for Minnow

## Status

**Implemented** — opt-in Settings toggle, server bind policy, WebSocket guards, API, tests, and docs.

## Goal

Let users on the **same local network** open Minnow in a **browser** (phone, tablet, another PC) while the host machine runs `npm start`. The **host** keeps using the Electron shell on `localhost`; remote devices get the SPA + `/api/*` against the host.

**Out of scope (v1):** Electron `browser_*` tools on remote devices, packaged-Electron LAN binding, internet exposure, auth tokens, HTTPS/mDNS.

## Usage

1. **Settings → General → Network access** — choose **This device only** (default) or **Local network**.
2. **Restart** Minnow (`npm start`) after changing the setting.
3. Open the copyable LAN URL from Settings on another device (same Wi‑Fi).
4. Optional env override: `MINNOW_NETWORK=lan` (wins over `config.json`).

### Windows Firewall

If phones cannot connect after enabling LAN mode, allow inbound TCP on your dev port (default **5173**) for Node.js in Windows Defender Firewall.

## Architecture

| Piece | Location |
|-------|----------|
| Policy + WS guard | [`server/network/access.js`](../../server/network/access.js) |
| LAN URL discovery | [`server/system/network.js`](../../server/system/network.js) |
| Config persistence | `config.json` → `server.networkAccess` |
| Settings UI | [`src/ui/settings-network.ts`](../../src/ui/settings-network.ts) |
| API | `GET /api/system/network` |

## Remote-device behavior

| Feature | Remote browser |
|---------|----------------|
| Chat, settings, models, compare, etc. | Works (same-origin API) |
| LLM inference | Works (providers on **host**) |
| `browser_*` tools | Unavailable (Electron-only on host) |
| Terminal PTY | Works when LAN + WS policy relaxed |
| Voice mic/TTS | Likely broken on `http://192.168.x.x` (secure context) |
| OAuth connect | Works only if user opens the same LAN URL used for redirect base |

## Security

- Default: `local` (loopback bind)
- LAN mode: WebSocket still **403** for non-private IPs
- Settings warning before enabling LAN
- No login in v1 — trusted networks only

## Follow-ups

- HTTPS (mkcert / reverse proxy) for voice + safer OAuth on mobile
- mDNS (`minnow.local`) or QR code in Settings
- LAN auth token for shared households
- Packaged Electron optional LAN bind

## Manual verification

1. Default: `npm start` — only `localhost:5173` reachable
2. Enable **Local network**, restart — console shows network URLs; phone opens chat UI
3. From phone: send message (host LM Studio running)
4. From phone: terminal panel connects
5. Toggle back to **This device only**, restart — phone connection refused
