# Setting up the Minnow Discord

How to build the community server from an empty (or nearly empty) Discord, in the order
Discord actually requires. The public invite is
[discord.gg/U4FPzv9K4X](https://discord.gg/U4FPzv9K4X) — it is already printed in the
[README](../../README.md) and the [Reddit launch post](../announcements/reddit-launch-post.md),
so treat that link as permanent and never let it expire.

Budget about 90 minutes end to end. Work top to bottom: Community unlocks half the features,
roles must exist before channel permissions can reference them, and Onboarding won't turn on
until the channels exist.

> **Voice:** the server is documentation register, same as the app — plain, unhurried, second
> person, no hype. See [PRODUCT.md](../../PRODUCT.md#brand-personality). All copy in this guide
> is written to paste as-is.

---

## 1. Server basics

**Server Settings → Overview**

| Setting | Value |
|---------|-------|
| Server name | `Minnow` |
| Icon | `public/logos/minnow-logo/minnow/png/minnow-512.png` |
| Invite splash / banner | `minnow-lockup-horizontal-1440.png` (needs Level 1 boost) |
| Default notifications | **Only @mentions** — required for Community, and the right default anyway |
| Inactive channel | Off |

A vanity URL (`discord.gg/minnow`) needs Level 3 boost — 14 boosts. Don't plan around it;
the current invite is fine.

## 2. Turn on Community

**Server Settings → Enable Community.** Discord requires these before it will flip the switch:

- Verification level **Medium** or higher (see [§7](#7-safety-and-moderation)).
- Explicit media content filter scanning **all** members.
- A rules channel and a moderator-updates channel (create `#rules` and a private `#mod-updates`
  first, then come back).
- Default notifications set to only @mentions.

It unlocks the things this server depends on: **forum channels** (support), **announcement
channels** (releases other servers can follow), **Onboarding**, **AutoMod**, **Server Insights**,
and Stage channels for office hours.

## 3. Roles

Build roles before channels — channel overrides reference them. **Server Settings → Roles**,
ordered highest to lowest (drag order *is* the permission hierarchy):

| Role | Color | Who | Key permissions |
|------|-------|-----|-----------------|
| `Maintainer` | Minnow accent | You | Administrator |
| `Moderator` | Muted blue | 1–2 trusted members, later | Manage Messages, Manage Threads, Kick, Ban, Timeout, Mute/Deafen, View Audit Log |
| `Contributor` | Green | Anyone with a merged PR | Nothing extra — it's recognition, plus posting rights in `#contributing` |
| `Bots` | Grey | Webhooks and apps | Only what each app needs |
| `@everyone` | — | Everyone | See [§4](#4-everyone-baseline) |

Then a set of **self-serve roles**, granted through Onboarding ([§6](#6-onboarding-and-welcome))
rather than a reaction-role bot. These carry no permissions; they exist so you can ping the
right slice of people and so members can mute what they don't care about:

| Self-serve role | Purpose |
|-----------------|---------|
| `Release notes` | Pinged on new versions. Opt-in — never ping @everyone for a release. |
| `Local models` | LM Studio / Ollama / llama.cpp crowd |
| `Orchestrator` | Boards, Super Plan, work agents |
| `Bug hunters` | People who want to be pulled into repro threads |
| `Windows` / `macOS` / `Linux` | Platform, for "can someone on macOS confirm this" |

**Contributor is worth handing out generously.** It costs nothing and it is the cheapest
signal that this is a project people build *on*, not just download.

## 4. @everyone baseline

**Server Settings → Roles → @everyone.** Leave defaults, with these changes:

- **Off:** Manage Events, Create Events, Manage Threads, Mention @everyone/@here, Manage
  Nicknames, Move Members.
- **On:** View Channels, Send Messages, Send Messages in Threads, Create Public Threads,
  Embed Links, Attach Files, Add Reactions, Read Message History, Use External Emoji,
  Connect, Speak, Use Voice Activity, Create Invite.

Keep **Create Invite** on. A closed server is not what this project is.

## 5. Channels

Start smaller than feels right. Empty channels read as a dead server; you can add a channel the
moment a conversation outgrows `#general`. This is roughly the minimum that still separates
support from chatter.

### START HERE

| Channel | Type | Who can post | Topic |
|---------|------|--------------|-------|
| `#rules` | Text | Maintainer only | *What this server is and the four rules. Read once.* |
| `#announcements` | **Announcement** | Maintainer only | *Releases, breaking changes, and project news. Follow this channel to get it in your own server.* |
| `#releases` | **Announcement** | Webhook only | *Automatic feed of new Minnow releases from GitHub.* |

### COMMUNITY

| Channel | Type | Topic |
|---------|------|-------|
| `#general` | Text | *Anything Minnow. Support questions go to #help.* |
| `#introductions` | Text | *What you build, what you run it on. Optional.* |
| `#showcase` | Text | *Things you made with Minnow — projects, boards, skills, themes, prompts.* |
| `#off-topic` | Text | *Everything else.* |

### HELP

| Channel | Type | Topic |
|---------|------|-------|
| `#help` | **Forum** | *One post per problem. Include your OS, Minnow version, and the model or provider you're using.* |
| `#bugs` | Text | *Confirmed bugs get filed at github.com/DukkyGames/Minnow/issues — this channel is for working out whether it's a bug first.* |
| `#feature-requests` | Text | *Ideas, before they're issues. No promises attached.* |

Forum tags for `#help` (Forum settings → Tags) — these mirror the apps in
[PRODUCT.md](../../PRODUCT.md), so triage maps straight onto the codebase:

`Install & update` · `Models & providers` · `Code` · `Chat` · `Orchestrator` · `Super Plan` ·
`Brain` · `Research` · `Issues` · `Scheduler` · `MCP & tools` · `Windows` · `macOS` · `Linux` ·
`Solved`

Turn on **Require tag on post** and set the default sort to Latest Activity.

### MODELS & HARDWARE

| Channel | Type | Topic |
|---------|------|-------|
| `#local-models` | Text | *What's working, what isn't, at what size. The floor moves fast — say what you ran it on.* |
| `#hardware` | Text | *Rigs, VRAM, quantization, tokens per second.* |

### BUILDING MINNOW

| Channel | Type | Topic |
|---------|------|-------|
| `#contributing` | Text | *PRs, skills, tools, themes, prompts. First contribution is as good as a feature.* |
| `#dev-log` | Text | Maintainer-only posts. *What I'm working on, in the open.* |
| `#github` | Text | Webhook only. *Issues and pull requests from the repo.* |

### VOICE

| Channel | Type | Notes |
|---------|------|-------|
| `General` | Voice | One is enough. |
| `Office hours` | Stage | Only if you actually schedule them. Delete it otherwise. |

### STAFF (private — deny View Channel to @everyone)

| Channel | Purpose |
|---------|---------|
| `#mod-updates` | Required by Community. Discord posts moderation notices here. |
| `#mod-chat` | Coordination. |
| `#mod-log` | AutoMod hits and bot audit output. |

`#dev-log` is the one channel to not skip. A visible maintainer log is what makes a one-person
project feel alive between releases.

## 6. Onboarding and welcome

**Server Settings → Onboarding.** Discord gates this behind a minimum number of default
channels visible and writable by @everyone (7 visible / 5 writable at the time of writing —
the settings page tells you exactly what you're short). The channel map above clears it.

Use **Advanced** mode so you get the Server Guide, then set two questions:

**Question 1 — "What do you run Minnow on?"** (multi-select, grants roles)

- Local models — LM Studio, Ollama, llama.cpp → `Local models`
- Cloud API — DeepSeek, Claude, GPT, GLM, Kimi → *(no role)*
- Windows → `Windows` · macOS → `macOS` · Linux → `Linux`

**Question 2 — "What do you want pinged about?"** (multi-select, grants roles)

- New releases → `Release notes`
- Orchestrator and Super Plan → `Orchestrator`
- Bug repros and testing → `Bug hunters`

**Server Guide → "Resources"** — three entries, no more:

| Label | Target |
|-------|--------|
| Read the rules | `#rules` |
| Get it running | [Setup guide](https://github.com/DukkyGames/Minnow/blob/main/documentation/guides/setup.md) |
| Ask for help | `#help` |

**Welcome Screen description:**

> A free and open source AI workspace that runs on the models you already have. This is where
> setup questions get answered, bugs get worked out, and releases get announced.

## 7. Safety and moderation

**Server Settings → Safety Setup**

| Setting | Value | Why |
|---------|-------|-----|
| Verification level | **Medium** (account older than 5 minutes) | Required for Community; stops the laziest spam. Go **High** only if you get raided. |
| Explicit media filter | Scan from all members | Required for Community. |
| DM spam filter | On | New members get DM-spammed on every OSS server. |
| Raid protection | On (activity alerts + suspicious join alerts) | Alerts land in `#mod-updates`. |
| Pause Invites | Know where it is | It's the panic button during a raid. |

**AutoMod rules** (Server Settings → AutoMod) — four rules cover almost everything:

1. **Spam content** — block. Catches copy-paste spam.
2. **Mention spam** — limit to 5 unique mentions per message, block + timeout.
3. **Commonly flagged words** — block the slurs and sexual-content presets; alert `#mod-log`.
4. **Custom keyword** — block invite-link patterns (`discord.gg/`, `discord.com/invite`) with
   `#showcase` and the staff channels exempted, plus `Moderator` and `Maintainer` roles exempt.
   Crypto/airdrop bait is the other list worth adding here.

Set every rule to alert `#mod-log` even when it also blocks — you want to see what's hitting.

**Moderators:** don't appoint any yet. One maintainer plus AutoMod is fine at this size, and a
mod team you recruited before you needed one is its own problem. Add the first Moderator when
you notice you're reading messages you didn't get to for six hours. Recruit from people already
answering questions in `#help`, not from volunteers who ask.

## 8. GitHub → Discord webhooks

Two feeds: releases into `#releases`, issues and PRs into `#github`. Both use GitHub's native
Discord support — no bot, no third-party service holding a token.

For each channel:

1. **Edit Channel → Integrations → Webhooks → New Webhook.** Name it `GitHub`, set the avatar,
   copy the URL.
2. In the repo: **Settings → Webhooks → Add webhook.**
3. **Payload URL:** the webhook URL with `/github` appended — this suffix is what makes GitHub's
   payload render properly:
   ```
   https://discord.com/api/webhooks/<id>/<token>/github
   ```
4. **Content type:** `application/json`.
5. **Which events:** *Let me select individual events.*
   - `#releases` → **Releases** only.
   - `#github` → **Issues**, **Pull requests**, and optionally **Discussions**. Leave `Pushes`
     off unless you want the noise.
6. Save, then check **Recent Deliveries** for a green 204.

Webhook posts into an announcement channel are **not** auto-published — hit **Publish** on the
release message so following servers get it. That's the one manual step, and it pairs naturally
with [the release checklist](releasing.md).

Treat the webhook URL as a secret. Anyone holding it can post as that webhook.

## 9. Bots

You need fewer than you think. Native Discord now covers role selection (Onboarding),
moderation (AutoMod), and the GitHub feed (webhooks).

| Want | Use | Verdict |
|------|-----|---------|
| Role menus | Onboarding | **Skip the bot.** |
| Auto-mod, keyword blocks | AutoMod | **Skip the bot.** |
| GitHub feed | Native webhook | **Skip the bot.** |
| Message/member logging | Carl-bot or Dyno | **Add one** — audit log alone won't show you deleted message content. |
| Support tickets | Ticket Tool | Skip. `#help` forum posts *are* the tickets. |
| Levels and XP | MEE6 et al. | Skip. Gamified chatter is not the point of this server. |

Any bot you do add: give it its own role under `Moderator`, grant only the permissions it names,
and put its output in `#mod-log`.

## 10. Copy to paste

### `#rules`

> **Minnow Discord**
>
> Minnow is a free and open source AI workspace. This server is for using it, breaking it, and
> building on it.
>
> **1. Be decent.** Disagree about models, licenses, and architecture all you like. Don't be
> cruel about it. No harassment, no bigotry, no personal attacks.
>
> **2. Keep it useful.** Support goes in #help, one post per problem. Bugs get worked out in
> #bugs and filed on GitHub. #general is for everything else Minnow.
>
> **3. No spam, no ads, no unsolicited DMs.** Sharing your own project in #showcase is welcome;
> DMing members about it is not. Report DM spam to a Moderator — it's not your fault and we want
> to know.
>
> **4. Nothing illegal, nothing NSFW.** Includes pirated models, weights, and software.
>
> Moderation is a warning, then a timeout, then a ban, except for spam and hate, which skip to
> the end. Appeals go to a Maintainer by DM.
>
> **Links**
> Repo: <https://github.com/DukkyGames/Minnow>
> Setup: <https://github.com/DukkyGames/Minnow/blob/main/documentation/guides/setup.md>
> Issues: <https://github.com/DukkyGames/Minnow/issues>
> License: AGPL-3.0-or-later
>
> Minnow has no telemetry and no account. Nothing you do in the app is visible here — if you
> want help, you'll have to tell us what happened.

### `#help` post guidelines (Forum → Guidelines)

> One post per problem. Before you post, put this at the top:
>
> - **OS and version** — Windows 11, macOS 15, Ubuntu 24.04
> - **Minnow version** — Settings → About
> - **Model and provider** — "Qwen 3.6 27B via LM Studio", "DeepSeek V4 via API"
> - **What you expected, what happened** — and the exact error text if there is one
> - **Logs** — Help → Open logs folder, attach the relevant file
>
> Tag your post. Mark it `Solved` when it's fixed — the next person searching will find it.
>
> Troubleshooting guide: <https://github.com/DukkyGames/Minnow/blob/main/documentation/guides/troubleshooting.md>

### Pin in `#bugs`

> **Is it a bug?** Work it out here first — half of what lands in this channel is a config
> issue, and the other half is a real bug that deserves a proper issue.
>
> Once it's confirmed and you can reproduce it, file it:
> <https://github.com/DukkyGames/Minnow/issues/new>
>
> GitHub is the source of truth for bugs. A Discord message is not a bug report — it scrolls
> away. Link the issue back here when you've filed it.

### First `#announcements` post

> Welcome. Minnow is in open beta: it works, it's rough in places, and bug reports are the most
> useful thing you can send me right now.
>
> Start at #rules, then #help if something won't run. Pick up `Release notes` in Onboarding if
> you want a ping when a new version ships — I won't @everyone for releases.
>
> Everything is AGPL-3.0-or-later and nothing is gated. If you want to build on it, #contributing
> is the channel.

## 11. Invites

**Server Settings → Invites**, and the invite on `#general`:

- The public invite must be **never expire, unlimited uses**. Verify
  [discord.gg/U4FPzv9K4X](https://discord.gg/U4FPzv9K4X) still resolves — it's printed in the
  README, the Reddit post, and anywhere else the launch reached. A dead invite there costs more
  than any other mistake on this page.
- Set the invite's landing channel to `#rules` or `#general`.
- Revoke any old temporary invites you created while testing.

Where the link belongs: README, the app's About/Help surface, GitHub repo **About** sidebar
(there's a website field and a link list), release notes footer, and the Reddit post.

## 12. Order of operations

Do it in this order — later steps depend on earlier ones.

- [ ] Server name, icon, default notifications → only @mentions
- [ ] Create `#rules` and private `#mod-updates`
- [ ] Verification **Medium**, explicit media filter → all members
- [ ] **Enable Community**
- [ ] Create roles (§3), set `@everyone` baseline (§4)
- [ ] Create categories and channels (§5), set staff channels private
- [ ] Forum tags on `#help`, require tag on post
- [ ] Post `#rules` content, set it as the rules channel
- [ ] AutoMod rules ×4, all alerting `#mod-log`
- [ ] DM spam filter + raid protection on
- [ ] Onboarding: two questions, Server Guide, welcome description
- [ ] GitHub webhooks → `#releases` and `#github`, verify 204
- [ ] Logging bot, if you want one
- [ ] Pin `#bugs` and `#help` templates
- [ ] Public invite → never expire, unlimited uses
- [ ] First `#announcements` post, and publish it
- [ ] Walk the join flow yourself from a second account or on mobile logged out

That last one catches more than the rest combined. Onboarding looks different from the outside.

## 13. Keeping it alive

A quiet server is a normal server for a project this size. What keeps it from dying:

- **Post in `#dev-log` when you're working**, even one line. Visible activity from the maintainer
  is the whole draw.
- **Announce every release** in `#announcements`, publish it, ping `Release notes` — not
  @everyone.
- **Answer in `#help` in public**, never in DMs. Every answered thread is documentation the next
  person finds.
- **Hand out `Contributor`** the day a PR merges.
- **Promote answers into the docs.** A question asked twice belongs in
  [troubleshooting.md](../guides/troubleshooting.md), not pinned in Discord.
- **Check `#mod-log` weekly** for what AutoMod is catching, and Server Insights monthly for where
  people drop off in Onboarding.
