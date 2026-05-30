# Add Caveman built-in skill to Minnow

Shipped: built-in `/caveman` from [juliusbrussee/caveman](https://github.com/JuliusBrussee/caveman) with sticky per-chat injection, intensity levels, composer pin chip, and Settings defaults.

## Usage

- **`/caveman`** — enable full-mode terse replies for the chat
- **`/caveman ultra …`** — set intensity for this chat
- **Composer chip** — change intensity or unpin
- **Settings → Skills → Caveman** — pin by default on new chats, default intensity
- **`stop caveman`** or **`normal mode`** — clear pin and return to normal tone

## Implementation map

| Area | Files |
|------|--------|
| Skill body | `src/skills/caveman/SKILL.md` |
| Upstream sync | `scripts/sync-caveman-skill.mjs`, `npm run caveman:sync` |
| Intensity augment | `src/skills/caveman-client.ts` |
| Sticky resolver | `src/skills/pinned-skill.ts`, `Chat.pinnedSkill` |
| Send path | `src/tools/loop.ts` |
| Composer UI | `src/ui/composer-pinned-skill.ts` |
| Settings | `src/skills/config.ts`, `src/ui/settings-skills.ts` |
| Tests | `test/skills/caveman-client.test.mts`, `test/skills/pinned-skill.test.mts` |

## Verification

```bash
npm run prebuild
npm run test:skills
npm start
```

1. `/caveman ultra why useEffect run twice` → terse reply; chip shows `ultra`
2. Follow-up without slash → still terse; history shows `[skill: caveman]`
3. `stop caveman` → normal tone; chip hidden
4. Settings “Pin on new chats” → new chat shows chip before first send
