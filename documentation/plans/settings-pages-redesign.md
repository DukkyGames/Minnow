# Settings pages redesign (Impeccable)

## Todos

- [x] Group sidebar nav into six categories (App, Models & APIs, Prompting & memory, Agents, Tools & integrations, Advanced)
- [x] Reorder sections to match nav and mental model
- [x] Add section leads (`settings-lead`) on every page
- [x] Group in-page panels (`settings-group`) on General and Tools
- [x] Move memory injection toggle next to memory store (Memory section)
- [x] Move global constrained tool calls to Tools → Structured tool arguments
- [x] Rename Features nav label to Orchestration (hash id `features` unchanged)
- [x] Update `documentation/context.md`
- [x] Model routing: full-width section (`settings-section--wide`), inline provider/model grid, bordered table groups

## Sidebar groups

| Group | Sections |
|-------|----------|
| App | General |
| Models & APIs | Providers, Usage & cost, Model routing |
| Prompting & memory | Prompting, Rules, Memory |
| Agents | Modes, Experts, Work agents, Agent packs, Sub-agents |
| Tools & integrations | Tools, MCP servers, Language servers, Skills |
| Advanced | Orchestration (`features`), Evals |

## Files

- `src/ui/settings-page-types.ts` — `SETTINGS_NAV_GROUPS`, labels, section order
- `src/ui/settings-layout.ts` — `appendSettingsGroup`, `linkToSettingsSection`
- `index.html` — nav + section markup
- `src/styles/settings-page.css` — nav groups, content groups
- `src/ui/settings-sections.ts` — General/Tools panel grouping
