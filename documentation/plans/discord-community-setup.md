# Minnow Discord community — setup plan

**Invite (live):** https://discord.gg/U4FPzv9K4X  
**Purpose:** Support users, coordinate contributors, and showcase what people build with Minnow — without turning the server into noise.

**Brand tone (from `PRODUCT.md`):** Calm, capable, technical without cosplay. Short, direct copy. Instrumentation over hype.

---

## Goals

| Goal | Success looks like |
|------|-------------------|
| **Onboard fast** | New member knows where to ask, where to read, and what Minnow is in &lt; 2 minutes |
| **Support efficiently** | Common LM Studio / provider / install questions get answered in `#help` with pointers to docs |
| **Grow contributors** | Clear path from “I found a bug” → GitHub issue → optional `#dev` discussion |
| **Stay maintainable** | Solo-dev friendly: low bot complexity at launch, templates reduce repeated answers |
| **Stay safe** | AGPL project + local-first posture: no credential sharing, no “paste your API key” culture |

---

## Recommended server structure

Use **Discord Community** features (Server Settings → Enable Community) for onboarding, rules screening, and `#announcements` / `#rules` auto-setup.

### Categories & channels

```
📌 START HERE
  #welcome          → bot posts; humans don't chat here
  #rules            → short rules + link to full policy
  #announcements    → releases, milestones (staff-only post)
  #links            → pinned docs, GitHub, sponsors, invite permalink

💬 COMMUNITY
  #general          → Minnow, local AI, workflows
  #showcase         → screenshots, demos, workflows you built
  #off-topic        → non-Minnow chat (keeps #general focused)

🆘 SUPPORT
  #help             → install, providers, models, “why won't it work”
  #help-troubleshooting → logs, errors, repro steps (optional split later)

🛠 DEVELOPMENT
  #dev-general      → architecture, ideas, “how does X work”
  #dev-prs          → WIP branches, review asks (link GitHub PRs)
  #feature-requests → discuss before opening GitHub issues
  #super-plan       → Orchestrate / Super Plan experiments (matches product focus)

🔇 STAFF (private)
  #mod-log          → automod / ban audit
  #staff            → internal coordination
```

**Channel notes**

- Start with **one** support channel (`#help`). Split only when volume justifies it.
- `#super-plan` is optional but aligns with current product momentum (Orchestrate, plans under `documentation/plans/`).
- Keep `#announcements` **read-only** for `@everyone` (Community servers do this by default).

### Voice (optional, phase 2)

- **Office hours** — occasional voice stage or “Community Hangout” channel when you have regular attendance.
- Skip voice at launch unless you plan weekly office hours.

---

## Roles & permissions

### Role hierarchy (top → bottom)

| Role | Who | Permissions |
|------|-----|-------------|
| **Owner** | You | Full |
| **Admin** | Trusted co-maintainers (if any) | Manage channels, roles, messages |
| **Moderator** | Community mods | Kick, timeout, manage messages |
| **Contributor** | Merged PR authors (manual or bot) | `#dev-*` visibility, optional color |
| **Sponsor** | GitHub Sponsors (manual) | Cosmetic + `#sponsors` if you add one |
| **Minnow User** | Default after rules accept | All public channels |
| **Muted** | Timeout escalation | Send messages off in support channels |

### Auto-role

- On **rules accept** (Community onboarding) or **reaction role** in `#welcome`: assign **Minnow User**.
- Do **not** give new members mention permissions in `#announcements`.

### Permission baseline

- `@everyone`: read public channels; send in community + support; **no** attach in `#rules` / `#announcements`.
- Staff roles: see `#staff` / `#mod-log`.

---

## Bots & integrations (phased)

### Phase 1 — launch (**chosen: minimal, no bot**)

Skip Carl-bot/Wick for now. Use Discord **Community onboarding** + pinned messages:

- **Rules screening** assigns `Minnow User` on accept (Server Settings → Enable Community → Onboarding)
- Pin the **welcome block** (below) at the top of `#welcome` — edit channel → “Create post” or pin a message you post manually
- Pin **rules** and **links** in their channels
- Rely on Discord’s built-in **AutoMod** (Server Settings → AutoMod): block `@everyone`/`@here` spam, mass mentions, and invite links if desired
- Create `#mod-log` but leave unused until you add a bot or need manual mod notes

**GitHub webhook** (no custom bot):

1. GitHub repo → Settings → Webhooks → Add webhook
2. URL: Discord channel webhook URL for `#announcements` (or `#dev-prs` for PR-only)
3. Events: Releases, Issues (optional), Pull requests (optional)
4. Use separate webhooks if you want releases in `#announcements` and PRs in `#dev-prs`

### Phase 2 — when volume grows

- **Sapphire** or **Discohook** for prettier embed templates
- **Statbot** for growth metrics (optional)
- **Ticket tool** (e.g. Ticket Tool) if `#help` becomes unmanageable — use only if needed

### Phase 3 — custom Minnow bot (future)

Possible features (not required at launch):

- `!docs <topic>` → link to `documentation/guides/`
- New release embed from GitHub API
- `/minnow version` → latest tag
- Contributor role sync from GitHub org/collaborators

---

## Copy-paste content

### Server name & description

- **Name:** Minnow
- **Description:** Local-first AI workspace for LM Studio and OpenAI-compatible providers.
- **Banner:** Calm dark/light screenshot of MinnowOS desktop (dock + chat), not neon HUD.

### `#rules` (short)

```
Welcome to Minnow.

1. Be respectful. No harassment, hate speech, or spam.
2. Local-first means your keys stay local — never post API keys, tokens, or `~/.minnow/.key` contents.
3. Support: use #help with OS, Minnow version, provider (LM Studio/Ollama/etc.), and what you tried.
4. Bugs & features: search GitHub issues first, then open a new issue with repro steps.
5. No piracy, warez, or unrelated crypto/NFT promotion.
6. AGPL: respect the license; commercial/network use of modified Minnow requires source availability.

Full docs: https://github.com/DukkyGames/Minnow#documentation-map
Mod decisions are final.
```

### `#links` (pin this)

```
Minnow — links
• GitHub: https://github.com/DukkyGames/Minnow
• Docs: documentation/context.md (in repo) · guides: documentation/guides/
• Quick start: README.md § Quick start
• Report bugs: GitHub Issues
• Sponsor: https://github.com/sponsors/DukkyGames
• Invite friends: https://discord.gg/U4FPzv9K4X
```

### `#welcome` (bot message template)

```
Welcome to **Minnow** 🐟

Minnow is a local-first AI workspace (MinnowOS) for LM Studio and other OpenAI-compatible providers — chat, tools, sub-agents, Code, Research, Calendar, and more.

**Start here**
1. Read #rules and accept the server rules
2. Grab roles in #roles (if enabled)
3. Ask in #help or chat in #general

**New to Minnow?** Clone the repo, `npm install`, `npm start` — see the README quick start.

Glad you're here.
```

### `#help` topic / channel description

```
Include: OS, Minnow version (`package.json` or About), provider + model, error text, and steps to reproduce. Redact secrets.
```

### `#announcements` post template (releases)

```
**Minnow vX.Y.Z** is out

**Highlights**
• …
• …

**Upgrade:** `git pull && npm install` (or download from Releases)

Full notes: <GitHub release URL>
```

---

## Moderation playbook

| Situation | Action |
|-----------|--------|
| Missing repro info | Point to `#help` template; don't guess |
| API key pasted | Delete message, warn, rotate key reminder |
| Off-topic flood | Redirect to `#off-topic` |
| Spam / scams | Ban + mod-log |
| Feature debate | Encourage GitHub issue for tracking |

**Response templates**

- *Install:* “See `documentation/guides/setup.md` — which step fails, and what's the exact error?”
- *LM Studio:* “Confirm server is on `http://localhost:1234` and a model is loaded in the LM Studio server tab.”
- *Bug:* “Please open a GitHub issue with OS, version, and repro — link it here if you want eyes on it.”

---

## Day 1 walkthrough (empty server, ~30 minutes)

Do these steps in the Discord client while logged in as server owner.

1. **Create / open server** → Server name: `Minnow`
2. **Server Settings → Enable Community** → follow wizard:
   - Set `#rules` and `#announcements` (rename defaults if needed)
   - Turn on **Membership screening** (rules must be accepted)
   - Default channels for new members: `#general`, `#help`, `#rules`
3. **Create channels** (right-click server → Create Category / Create Channel):

   | Category | Channels |
   |----------|----------|
   | START HERE | `welcome`, `rules`, `announcements`, `links` |
   | COMMUNITY | `general`, `showcase`, `off-topic` |
   | SUPPORT | `help` |
   | DEVELOPMENT | `dev-general`, `dev-prs`, `feature-requests` |
   | STAFF (private) | `mod-log`, `staff` |

4. **Roles** → Create `Minnow User` (color: neutral gray/blue) → Onboarding → assign on rules accept
5. **Channel permissions**:
   - `#announcements`, `#rules`, `#welcome`: deny `Send Messages` for `@everyone`
   - `#staff`, `#mod-log`: visible only to you (add Mod role later)
6. **Paste content** from [Copy-paste content](#copy-paste-content) into `#rules`, `#links`, `#welcome`, `#general` (sticky intro)
7. **Server icon**: use `public/icons/` app icon or fish glyph from the repo
8. **Invite**: Server Settings → Invites → set **never expire** for the permanent link; confirm it matches `https://discord.gg/U4FPzv9K4X` (or update README if you regenerate)
9. **GitHub** (optional today, recommended this week): webhook on Releases → `#announcements`
10. **Test**: open invite in a private/incognito window; accept rules; confirm you land in `#general` and can post in `#help`

---

## Setup checklist (do in order)

### A. Server foundation

- [ ] **A1.** Open Discord → your server → **Server Settings**
- [ ] **A2.** **Enable Community** (Membership screening + rules + default channels)
- [ ] **A3.** Set **Server Profile**: name `Minnow`, icon (fish glyph / app icon), description, banner
- [ ] **A4.** **Safety setup**: verification level **Low** or **Medium**; explicit media filter **Scan media from all members**
- [ ] **A5.** Create categories/channels per structure above (or rename Community defaults)
- [ ] **A6.** Set channel permissions: lock `#announcements`, `#rules`, `#welcome` for regular members

### B. Roles

- [ ] **B1.** Create roles: `Minnow User`, `Contributor`, `Moderator`, `Sponsor` (colors: subtle, on-brand)
- [ ] **B2.** Configure **Onboarding** (Community): default channels `#general`, `#help`, `#rules`
- [ ] **B3.** Map **rules screening** → assign `Minnow User` on accept

### C. Content

- [ ] **C1.** Paste and pin content in `#rules`, `#links`
- [ ] **C2.** Post a welcome sticky in `#general` pointing to `#help` and GitHub
- [ ] **C3.** Post first `#announcements` message (even if “Discord is live”)

### D. Integrations

- [ ] **D1.** ~~Add bot~~ **Deferred** — use pins + Community onboarding (revisit when `#help` &gt; ~10 msgs/day)
- [ ] **D2.** Enable **AutoMod** rules (invite spam, mention spam)
- [ ] **D3.** Create Discord **webhook** for `#announcements`
- [ ] **D4.** Add GitHub webhook for **Releases** (and optionally PRs to `#dev-prs`)
- [ ] **D5.** Add invite link to README (already present) + GitHub repo **About** → Social link → Discord

### E. GitHub repo surfacing

- [ ] **E1.** GitHub → **Discussions** (optional): enable Q&A category; link from `#help` for long-form
- [ ] **E2.** Issue templates: bug report + feature request (if not already)
- [ ] **E3.** `CONTRIBUTING.md` (optional): “Join Discord for chat; use Issues for tracked work”

### F. Launch

- [ ] **F1.** Soft launch: invite a few beta users to `#help` dry-run
- [ ] **F2.** Announce on GitHub README / release notes / sponsors
- [ ] **F3.** Schedule monthly check-in: review unanswered `#help` threads

---

## Growth & metrics (lightweight)

Track informally at first:

- New members / week
- `#help` threads with **no reply in 48h** (your SLA as solo dev)
- Repeat questions → add to `documentation/guides/troubleshooting.md` or FAQ pin

---

## Decisions (aligned 2026-07-12)

| Question | Decision |
|----------|----------|
| Server state | **Empty** — build full structure from scratch |
| Primary focus | **Balanced** — support + contributors + community/showcase |
| Bot (day one) | **Minimal** — no bot; manual pins + Community onboarding only |
| Public voice/office hours? | Defer until regular attendance |
| GitHub Discussions | Optional phase 2; Issues remain source of truth |

---

## Related repo touchpoints

- README § Support: Discord invite + GitHub Sponsors
- `PRODUCT.md` — tone reference for all public copy
- `documentation/guides/troubleshooting.md` — canonical answers to escalate from Discord
- `documentation/guides/setup.md` — first link for new users

---

## Todos

- [ ] Run **Day 1 walkthrough** above (empty server → full channel skeleton)
- [ ] Complete checklist sections **A–C** (pins, roles, onboarding)
- [ ] Enable **AutoMod** + GitHub release webhook (**D2–D4**)
- [ ] Add Discord link to GitHub repo **About** section
- [ ] Soft launch with 3–5 trusted users; fix channel friction
- [ ] (Optional) Add `CONTRIBUTING.md` pointing Discord vs Issues
- [ ] (Phase 2) Add Carl-bot when welcome/mod load justifies it
- [ ] (Phase 2) Split `#help` only if &gt; ~20 messages/day sustained
- [ ] (Phase 3) Spec custom Minnow bot if automation needs outgrow Carl-bot
