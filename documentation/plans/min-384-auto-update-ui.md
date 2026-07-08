# MIN-384 — Auto-update UI design brief

**Linear:** [MIN-384](https://linear.app/minnowai/issue/MIN-384/auto-update-for-the-desktop-app-electron-updater-release-channel)  
**Status:** Shape complete — awaiting confirmation before `craft`  
**Register:** Product (Settings + menubar instrumentation)

---

## 1. Feature summary

Packaged Minnow desktop installs (Windows NSIS today) need a **transparent, calm update system** so users always know which version they run, whether a newer build exists, and exactly what happens next. The UI lives primarily in **Settings → General → App updates**, with a **menubar affordance** only when something needs attention (downloading or ready to restart). Background check failures stay silent per issue spec; **manual checks and active update flows always show explicit inline status** so nothing feels hidden.

**Audience:** Daily-driver developers on Windows (v1), later macOS when signing exists. They install once, work long sessions, and expect security fixes to arrive without hunting GitHub.

---

## 2. Primary user action

**Understand current update state at a glance, then restart when an update is ready** — without interrupting an active chat or agent run until they choose.

---

## 3. Design direction

| Axis | Choice |
|------|--------|
| **Color strategy** | Restrained (matches PRODUCT.md). Semantic green / amber / muted only for status dot and download progress; ink accent on primary "Restart to update". |
| **Scene sentence** | Developer at a desk, mid-session in a bright room, glancing at the menubar between tool calls to confirm Minnow is current before leaving for the day. |
| **Anchor references** | **VS Code** "Check for Updates" clarity; **Linear** settings density and segment toggles; **Raycast** menubar pill that appears only when actionable. |

**Anti-goals:** No modal on launch, no toast spam, no hero "NEW VERSION!" banner, no gradient celebration, no blocking splash during download.

---

## 4. Scope (this shape)

| Dimension | Target |
|-----------|--------|
| Fidelity | Production-ready spec (implementation via `craft`) |
| Breadth | Full flow: Settings section + menubar states + restart popover |
| Interactivity | Shipped-quality components wired to `electron-updater` IPC |
| Surfaces | Electron packaged app only; hidden in browser tab and `MINNOW_ELECTRON_DEV` |

---

## 5. Layout strategy

### 5.1 Settings → General — new first group: **App updates**

Place **above** "Chat & terminal" — this group is about the installed shell, not chat behavior.

```
┌─ App updates ─────────────────────────────────────────────────┐
│ Stay on the latest build. Downloads run in the background;    │
│ restart when you are ready.                                   │
│                                                               │
│ ┌─ Status strip (instrumentation, not a card) ─────────────┐ │
│ │ ● Up to date — version 1.2.3                              │ │
│ │   or  ↓ Downloading 1.2.4 · 67%  [━━━━━━░░░░]            │ │
│ │   or  ● Restart to update — 1.2.4 is ready               │ │
│ │   or  — Could not check (offline)                         │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                                               │
│ Installed version     1.2.3                                   │
│ Update channel        [ Stable ] [ Beta ]   ← segment control │
│ Last checked          Today at 11:04 PM                         │
│ Next automatic check  In about 4 hours                        │
│                                                               │
│ [ Check for updates ]    [ Restart to update ]  (when ready)  │
│                                                               │
│ ▸ What's new in 1.2.4   (expandable; only when update known)  │
│                                                               │
│ hint: Beta builds may be less stable. Switching channel       │
│       takes effect on the next check.                         │
│ hint (macOS): Auto-update requires code signing — not yet       │
│       available on macOS.                                     │
└───────────────────────────────────────────────────────────────┘
```

**Hierarchy:** Status strip is the focal point (mono + status dot, same vocabulary as menubar model pill). KV rows are secondary reference. Actions are tertiary except when `update-ready`, when **Restart to update** promotes to primary button styling.

**Reuse existing patterns:**
- `appendSettingsGroup` + `createSettingsKvList` ([`settings-sections.ts`](../../src/ui/settings-sections.ts))
- Segment buttons from [`settings-network.ts`](../../src/ui/settings-network.ts) (`settings-network-segments` → new `settings-update-channel-segments` or shared `settings-segment-group`)
- Actions row from `createSettingsActionsRow`
- Warning/hint tone from `settings-field-hint` / `settings-network-warning`

**Anchor id:** `settingsAppUpdates` / `#/settings/general` with `data-settings-search-key="general.updates"`.

### 5.2 Menubar — contextual update pill

Insert in **right cluster**, immediately **before** the settings gear (not the bell — notifications stay separate).

| Updater state | Menubar chrome |
|---------------|----------------|
| Up to date / idle | **Hidden** — zero noise |
| Checking (manual) | Optional 32px ghost tile with subtle spinner (only if check triggered from menubar popover) |
| Downloading | Compact pill: `↓ 67%` mono, `aria-live="polite"` |
| Ready to restart | **Filled accent pill**: `Restart · 1.2.4` — highest visibility in calm UI |
| Dev / browser | Hidden |

**Click behavior (ready or downloading):** Open anchored popover (mirror notifications menu pattern in [`notifications-menu.ts`](../../src/os/notifications-menu.ts)):

```
┌ Update ready ──────────────────┐
│ Minnow 1.2.4 is downloaded.      │
│                                  │
│ • Security fix for tool server   │
│ • Preview pane stability         │
│ (release notes excerpt, 3 lines) │
│                                  │
│ [ Restart now ]  [ Later ]       │
│ Open Settings →                  │
└──────────────────────────────────┘
```

"No modal as first thought" — popover is justified because restart is destructive to in-flight state; user needs version context in one place.

### 5.3 Application menu (Windows) — optional parity

Tray/menu entry: **Help → Check for Updates** mirrors Settings manual check (same IPC). Low priority for v1 if menubar + Settings cover the flow.

---

## 6. Key states

| State | User sees | User feels |
|-------|-----------|------------|
| **Packaged, up to date** | Settings: green dot "Up to date"; menubar clean | Confident, ignored |
| **Update available, downloading** | Settings: progress bar + version label; menubar `↓ N%` | Informed, not interrupted |
| **Download complete** | Settings: "Restart to update"; menubar accent pill | Clear next step |
| **Manual check: no update** | Settings strip: "Up to date — checked just now" | Reassured |
| **Manual check: failed** | Settings strip: "Could not check" + hint (offline / GitHub unreachable) | Informed, not alarmed |
| **Background check failed** | Nothing (log only per MIN-384) | Uninterrupted |
| **Offline → online** | Next scheduled check resumes; no error toast | Seamless |
| **Channel switch Stable ↔ Beta** | Segment updates; hint "Next check will use Beta"; no reinstall | Deliberate |
| **Beta selected** | Amber hint under channel control | Warned, not scared |
| **Dev / unpackaged** | Group replaced with hint: "Updates apply to installed Minnow from minnow.ai" | Not confused |
| **macOS unsigned** | Group visible but disabled with signing note | Expectation set |

---

## 7. Interaction model

### Automatic flow
1. **Launch:** main process checks GitHub Releases (`latest.yml` / channel feed); never blocks window.
2. **Every N hours** (default 4): background recheck.
3. **Download:** silent background; renderer receives IPC progress events.
4. **Ready:** menubar pill appears; optional single OS notification if user enabled notifications (reuse existing prefs, category `updates` — off by default to avoid nagging).

### Manual flow
1. User clicks **Check for updates** in Settings.
2. Button → loading disabled state; status strip → "Checking…".
3. Result inline: up to date / downloading / ready / error (never toast-only).

### Restart flow
1. **Restart to update** (Settings or popover) → confirm if active generation detected? **v1: no extra confirm** — electron-updater quitAndInstall is standard; copy warns "Active chats will reconnect on launch."
2. App quits and installs; relaunch.

### Channel switch
1. Toggle Stable / Beta segment.
2. Persist to `~/.minnow/config.json` or electron-store (key `updates.channel`).
3. Trigger immediate check (debounced 300ms).
4. Show inline "Checking Beta channel…".

---

## 8. Content requirements

### Copy (final strings)

| Element | Copy |
|---------|------|
| Group title | App updates |
| Group lead | Stay on the latest build. Downloads run in the background; restart when you are ready. |
| Status: up to date | Up to date |
| Status: checking | Checking for updates… |
| Status: downloading | Downloading {version} · {percent}% |
| Status: ready | Restart to update — {version} is ready |
| Status: check failed | Could not check for updates |
| Status: offline hint | Offline. Will retry when you are back online. |
| KV: installed | Installed version |
| KV: channel | Update channel |
| Channel: stable | Stable |
| Channel: beta | Beta |
| KV: last checked | Last checked |
| KV: next check | Next automatic check |
| KV: never | Never |
| KV: just now | Just now |
| KV: in ~N hours | In about {n} hours |
| Button: check | Check for updates |
| Button: restart | Restart to update |
| Button: later | Later |
| Beta hint | Beta builds may be less stable. You can switch back to Stable anytime. |
| macOS hint | macOS auto-update requires code signing. Use manual download until certificates are configured. |
| Dev hint | Updates apply to the installed Minnow app, not this dev session. |
| Popover title (ready) | Update ready |
| Popover title (downloading) | Downloading update |
| Release notes toggle | What's new in {version} |
| Restart warning | Active sessions will close and Minnow will reopen. |

### Dynamic ranges
- Version string: `major.minor.patch` + optional `(build sha)` — mono font.
- Release notes: 0–2 KB markdown rendered as 3–8 bullets in expandable panel.
- Progress: 0–100% integer.

---

## 9. Technical UI wiring (for craft)

### New files (proposed)
| File | Role |
|------|------|
| `electron/updater.ts` | `autoUpdater` lifecycle, channel, schedule |
| `src/ui/settings-updates.ts` | Settings group renderer |
| `src/os/update-menubar.ts` | Menubar pill + popover |
| `src/styles/settings-updates.css` | Status strip, progress bar |
| `src/electron/updater-client.ts` | Renderer IPC wrapper |

### IPC channels (add to `ipc-channels.ts`)
- `minnow:updater:get-status` → `{ state, version, pendingVersion, progress, channel, lastCheckedAt, nextCheckAt, releaseNotes?, error? }`
- `minnow:updater:check-now`
- `minnow:updater:restart`
- `minnow:updater:set-channel` → `{ channel: 'stable' \| 'beta' }`
- `minnow:updater:status-changed` (main → renderer event)

### Settings registry
Add keys to `server/settings/registry-manifest.json` + `storage-overlay.ts` for agent discoverability:
- `general.updates`
- `general.updates.channel`

### Search catalog
Keywords: `update`, `version`, `upgrade`, `beta`, `release`, `restart`

### Accessibility
- Status strip: `role="status"` `aria-live="polite"` (not assertive — calm).
- Progress: `role="progressbar"` `aria-valuenow/min/max`.
- Segment group: `role="group"` `aria-label="Update channel"`.
- Menubar pill: `aria-label="Restart to update Minnow to version 1.2.4"` when ready.

---

## 10. Recommended impeccable references for craft

| Reference | Why |
|-----------|-----|
| `harden.md` | Offline, corrupt download, channel edge cases |
| `clarify.md` | Status copy pass |
| `layout.md` | Settings group rhythm vs network section |
| `animate.md` | Progress bar transition (opacity/transform only, 150–200ms ease-out-quart) |

---

## 11. Open questions (defaults chosen)

| Question | Default |
|----------|---------|
| OS notification when update ready? | Off by default; respect `general.notifications` master toggle if we add `updates` sub-toggle later |
| Confirm dialog before restart? | No extra modal v1; inline copy warning only |
| Show commit SHA in version KV? | Yes, muted mono suffix when available from `app.getVersion()` + `process.env` build id |
| Check interval configurable? | No v1 — fixed 4h; show read-only "Next automatic check" |

---

## 12. Implementation todos (craft)

- [ ] `electron/updater.ts` — electron-updater + GitHub publish config
- [ ] IPC channels + preload bridge
- [ ] `renderAppUpdatesSettings()` in General section
- [ ] Menubar pill + popover (`update-menubar.ts`)
- [ ] CSS: status strip, channel segments, progress
- [ ] Settings search + registry manifest entries
- [ ] Hide/disable surfaces for dev + browser + unsigned macOS
- [ ] Tests: updater state machine (unit), settings render (tsx)
- [ ] Docs: `README.md` packaging, `documentation/guides/commands.md`, `context.md`

---

## Visual direction probes

Two lanes explored (see attached images in shape thread):

1. **Instrumentation-first** (recommended): Settings status strip + hidden-until-ready menubar pill — matches Minnow "calm local instrument".
2. **Menubar-forward**: Persistent version chip in menubar — rejected as too noisy for daily use.

**Winner:** Lane 1 — clarity lives in Settings; menubar only speaks when action is required.
