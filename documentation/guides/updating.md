# Updating Minnow

How updates flow through Minnow — **releasing** a new version (for maintainers) and
**receiving** one (for users). Auto-update is built on
[`electron-updater`](https://www.electron.build/auto-update) against **GitHub Releases**
(`DukkyGames/Minnow`). Implementation: [`electron/updater.ts`](../../electron/updater.ts) +
[`electron/updater-core.ts`](../../electron/updater-core.ts); UI in
[`src/ui/settings-updates.ts`](../../src/ui/settings-updates.ts) and
[`src/os/update-menubar.ts`](../../src/os/update-menubar.ts). Tracked in
[MIN-384](https://linear.app/minnowai/issue/MIN-384).

> **What works today:** Windows (NSIS) auto-update is live. macOS builds can be produced,
> but macOS auto-update is intentionally disabled until code signing exists (see
> [Signing status](#signing-status) below) — the Settings panel shows a disabled state with
> a signing note. Dev and browser sessions can't self-update and show a hint instead of
> controls. This guide documents the full multi-platform process so it's ready as signing
> and platforms come online.

---

## Part 1 — Releasing a new version (maintainers)

### The mental model

- **One GitHub release per version.** You do *not* make a separate release per platform.
  Every platform's files are attached to the same `v<version>` release.
- **Artifacts are per-platform**, and each platform has **its own installer and its own
  update feed file**. `electron-updater` fetches the feed matching the OS it runs on, so
  the platforms never collide:

  | Platform | Installer artifact(s) | Feed file | Built with |
  |----------|-----------------------|-----------|------------|
  | Windows | `Minnow-Setup-<version>.exe` (+ `.blockmap`) | `latest.yml` | `npm run package` **on Windows** |
  | macOS | `Minnow-<version>-<arch>.dmg` + `Minnow-<version>-<arch>-mac.zip` (+ `.blockmap`s) | `latest-mac.yml` | `npm run package:mac` **on a Mac** |

  (Both `arch` variants — `arm64` / `x64` — appear if you build for both Apple Silicon and
  Intel. The `.zip` is what macOS auto-update consumes; the `.dmg` is for manual download.)

- **Each platform must be built on its own OS.** electron-builder can't reliably
  cross-compile a real macOS `.dmg` from Windows (and vice-versa). Use native machines or a
  CI matrix — see [Automating with CI](#automating-with-ci-recommended).
- **Packaging never uploads.** `electron-builder` runs with `--publish never` (via
  [`scripts/electron-builder-run.mjs`](../../scripts/electron-builder-run.mjs)); the
  `build.publish` config in [`package.json`](../../package.json) exists only so packaging
  emits the `latest*.yml` feed files. You create the release yourself.

### Step 1 — Bump the version (once, shared across all platforms)

Edit `version` in [`package.json`](../../package.json) and commit it:

```jsonc
{
  "version": "1.0.1"   // was 1.0.0
}
```

**Mandatory for every release.** An installed app decides whether to update by comparing
its own version against the one in the feed file. No bump → no upgrade. Use
[semver](https://semver.org/): patch for fixes, minor for features. Do this **before**
building on any platform so every artifact carries the same version, and push the commit so
the release tag points at it.

### Step 2 — Build on each platform

Run the matching package command **on each target OS**, from the same commit:

```bash
# On Windows
npm run package        # → release/pkg/Minnow-Setup-1.0.1.exe + latest.yml + .blockmap

# On a Mac
npm run package:mac    # → release/pkg/Minnow-1.0.1-*.dmg + *-mac.zip + latest-mac.yml + .blockmaps
```

Each command runs `build → electron:build → electron-builder` and writes to `release/pkg/`
on that machine. You'll gather the outputs from each machine in Step 3.

> If you only ship Windows for now, you only run the Windows build — a release with just the
> Windows artifacts is complete and correct. Mac users simply won't see an update until a
> signed macOS build is attached and macOS auto-update is enabled.

### Step 3 — Create one release and attach every platform's files

Because the builds come off different machines, the reliable pattern is: **create the
release as a draft, upload each platform's files to it, then publish.** Keeping it a draft
until all files are attached means users never see a half-assembled release.

**3a. On the first machine, create the draft** (here, with the Windows artifacts):

```bash
gh release create v1.0.1 \
  release/pkg/Minnow-Setup-1.0.1.exe \
  release/pkg/latest.yml \
  release/pkg/Minnow-Setup-1.0.1.exe.blockmap \
  --repo DukkyGames/Minnow \
  --title "Minnow 1.0.1" \
  --notes "- What changed, written for users" \
  --draft
```

- The tag `v1.0.1` is created from the current `HEAD` (pass `--target <sha>` to pin it).
- The release **body** is what users see under "What's new" in Settings and the menubar
  popover — write it for users. `--notes-file CHANGELOG.md` or `--generate-notes` also work.

**3b. On the Mac, upload the macOS files to the same tag** (does *not* recreate the release):

```bash
gh release upload v1.0.1 \
  release/pkg/Minnow-1.0.1-arm64.dmg \
  release/pkg/Minnow-1.0.1-arm64-mac.zip \
  release/pkg/Minnow-1.0.1-x64.dmg \
  release/pkg/Minnow-1.0.1-x64-mac.zip \
  release/pkg/latest-mac.yml \
  --repo DukkyGames/Minnow
```

(Adjust filenames to whatever your Mac build actually produced.) Re-uploading a same-named
asset needs `--clobber`; distinct platform filenames won't collide.

**3c. Publish once everything is attached:**

```bash
gh release edit v1.0.1 --repo DukkyGames/Minnow --draft=false
```

**Web UI equivalent:** Releases → **Draft a new release** → tag `v1.0.1`, add notes, drag in
the first platform's files, **Save draft**. Later, **Edit** the release and drag in the other
platform's files → **Update release** → publish. You can edit assets any number of times.

> **Each machine needs `gh` authenticated** (`gh auth login`) with push access to
> `DukkyGames/Minnow`, or use the web UI from a logged-in browser.

### Step 4 — Pick the channel

The **pre-release** flag is the channel switch (applies to the whole release, all platforms):

| GitHub setting | Who receives it |
|----------------|-----------------|
| **Latest release** (not a pre-release) | Everyone on the **Stable** channel. |
| **Pre-release** (`--prerelease`, or the web checkbox) | Only users on the **Beta** channel. |

Beta rides GitHub pre-releases via `autoUpdater.allowPrerelease` — there's no separate beta
feed to maintain.

### Signing status

Signing is what unblocks **auto-update** on each platform (it's separate from being able to
*build* the artifact):

| Platform | Signing today | Effect |
|----------|---------------|--------|
| Windows | **Unsigned** | Works, but the *first manual install* may hit SmartScreen ("More info → Run anyway"). Auto-updates after that are silent. |
| macOS | **None yet** | An unsigned macOS app **cannot auto-update** (Squirrel.Mac rejects unsigned updates), so the app reports `unsupported` on macOS and shows the signing note. |

**Enabling macOS auto-update later takes two things**, not one:
1. An Apple Developer ID cert to **sign + notarize** the build (notarization must run on a
   Mac), configured in electron-builder.
2. Removing the `darwin → unsupported` guard in `detectSupport()` in
   [`electron/updater.ts`](../../electron/updater.ts) so the updater actually runs on macOS.

For **Windows signing**, note the cert type matters if you ever cross-sign: an OV `.pfx`
cert can be applied from macOS/Linux via `osslsigncode`, but EV / hardware-token / Azure
Trusted Signing certs generally require Windows or the vendor's tooling. Native per-OS
builds (below) sidestep this entirely.

### Release checklist

```
[ ] Bumped version in package.json and committed + pushed
[ ] Built on every platform you're shipping (npm run package / package:mac), same commit
[ ] release/pkg/ on each machine has its installer + feed file (latest.yml / latest-mac.yml)
[ ] Created ONE GitHub release tagged v<version> (as a draft)
[ ] Uploaded every platform's artifacts to that release (incl. each feed file)
[ ] Release notes written for users
[ ] Pre-release flag correct (off = Stable, on = Beta)
[ ] Published the release (draft → published)
```

### Automating with CI (recommended)

Juggling machines by hand doesn't scale. The standard approach is a **GitHub Actions matrix**
with native runners — each OS builds and signs itself, then uploads its artifacts to the same
release:

```yaml
strategy:
  matrix:
    os: [windows-latest, macos-latest]   # add ubuntu-latest for Linux later
```

Each runner runs its `package` command and, because signing happens on the native OS, avoids
Wine / `osslsigncode` workarounds. electron-builder's own `--publish` can push straight to the
GitHub release (you'd call `electron-builder --publish always` in CI instead of the local
`--publish never` wrapper), so no manual `gh release upload` step is needed. This is the target
state once macOS signing lands; until then the manual Windows flow above is enough.

---

## Part 2 — Receiving updates (users)

Automatic and calm by design. On a packaged Windows install:

### The automatic flow

1. **Check.** 15 seconds after launch, then every 4 hours, the app fetches the feed file for
   its platform and compares versions. Launch is never blocked on this.
2. **Download.** A newer version downloads in the background automatically — no prompt, no
   interruption.
3. **Install on your terms.** Click **Restart to update** when you're ready. If you never
   do, the update installs automatically the next time you quit Minnow normally.

### Where you see it

**Menubar pill** (left of the settings gear) — silent unless there's something to act on:

| State | Pill |
|-------|------|
| Up to date | Hidden — zero noise. |
| Downloading | `↓ 67%` |
| Ready | Accent **`Restart · 1.0.1`** — click for a popover with release notes, **Restart now** / **Later**, and a link to Settings. |

**Settings → General → App updates** — the full picture and all manual controls:

- **Status strip:** up to date / checking / downloading % / ready / couldn't check.
- **Installed version**, **Last checked**, **Next automatic check**.
- **Update channel:** Stable / Beta toggle.
- **Check for updates** button (manual check).
- **Restart to update** button (appears when a build is ready).
- **What's new** expander with the release notes.

### Switching channels

Toggle **Stable ↔ Beta** in Settings → General → App updates. No reinstall — the choice
persists to `~/.minnow/updater.json` and triggers an immediate re-check. Beta simply opts
you into GitHub pre-releases, which may be less stable; switch back anytime.

### What happens on failure

Deliberately quiet:

- **Background check fails** (offline, GitHub unreachable) → silent, logged, retried next
  cycle. No toasts.
- **You click "Check for updates" and it fails** → an inline error in the status strip
  (the only place failures surface, since you asked).
- **A download is interrupted** → retried on the next cycle; a build that already finished
  downloading stays "ready" and is never lost to a later failed check.

---

## Testing the full loop

The complete "old install upgrades itself" path can only be exercised once **two** versions
exist on GitHub Releases. The practical first validation:

1. Release `1.0.1`, install it.
2. Release `1.0.2`.
3. Launch the `1.0.1` install and confirm it detects `1.0.2`, downloads, shows the menubar
   pill, and installs on restart.

Unit coverage for the state machine and UI lives in
[`test/electron/updater-core.test.mts`](../../test/electron/updater-core.test.mts),
[`test/settings/settings-updates.test.mts`](../../test/settings/settings-updates.test.mts),
and [`test/os/update-menubar.test.mts`](../../test/os/update-menubar.test.mts).

---

## Reference

| Concern | Where |
|---------|-------|
| Updater controller (schedule, download, install, platform gate) | [`electron/updater.ts`](../../electron/updater.ts) |
| State machine (pure, testable) | [`electron/updater-core.ts`](../../electron/updater-core.ts) |
| IPC channels (`minnow:updater:*`) | [`electron/ipc-channels.ts`](../../electron/ipc-channels.ts) |
| Renderer bridge + display helpers | [`src/electron/updater-client.ts`](../../src/electron/updater-client.ts) |
| Settings UI | [`src/ui/settings-updates.ts`](../../src/ui/settings-updates.ts) |
| Menubar pill + popover | [`src/os/update-menubar.ts`](../../src/os/update-menubar.ts) |
| Windows feed file | `latest.yml` (attached to the release) |
| macOS feed file | `latest-mac.yml` (attached to the release) |
| Persisted channel choice | `~/.minnow/updater.json` |
| Build targets per platform | [`package.json`](../../package.json) `build.win` / `build.mac` |
| Publish config (`--publish never` locally) | [`package.json`](../../package.json) `build.publish` + [`scripts/electron-builder-run.mjs`](../../scripts/electron-builder-run.mjs) |
| Package commands | `npm run package` (host OS), `package:win`, `package:mac`, `package:dir` |
| Packaging overview | [`../getting-started.md`](../getting-started.md#packaging-a-desktop-build) |
