# Operating mode sources (OpenCode mapping)

| OpenCode concept | SpeedChat (Step 05) |
|------------------|---------------------|
| Primary agent **Build** | `build` — full tool access |
| Primary agent **Plan** | `plan` — deny shell, writes, git mutations |
| Tab cycle primary agents | Segmented control above composer |
| `permission.edit` / `permission.bash` | `ModeToolPolicy` in `src/chat/modes/registry.ts` → `filterToolsByMode()` |
| Agent prompt files | `src/chat/prompts/modes/{id}.{full,lite}.md` |
| Session active agent | `Chat.modeId` in `sessions/state.json` |
| **General** subagent (broad) | Inspiration for `orchestrate` |
| **Explore** / read-heavy subagents | Inspiration for `research` |

SpeedChat adds **Orchestrate** and **Research** as product-specific primaries (not OpenCode built-ins).

References: [OpenCode Agents](https://opencode.ai/docs/agents/), [OpenCode Permissions](https://opencode.ai/docs/permissions/).
