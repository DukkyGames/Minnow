# Brain App Redesign: Knowledge Graph

## Design brief (impeccable shape)

**1. Feature summary.** Turn the Brain app from a static wiki/tree browser into an animated knowledge-graph workspace. Pages and tags become nodes connected by wikilinks; folders drive an expandable tree; selecting a node opens an inspector. The Code section gets a symbol call-graph using the same engine. All nine sections are restyled to one cohesive, desktop-native system with purposeful motion.

**2. Primary user action.** Explore relationships: land on the graph, follow/expand links between pages (or symbols), and open a node to read, edit, or create knowledge.

**3. Design direction.** Hybrid: the graph canvas is a rich animated stage (deep theme-tinted backdrop, soft node glow, pulsing active node, edge draw-in) while trees, panels, inspector, and other sections stay on-brand using `--mn-*` OKLCH tokens and respect light/dark themes. Glow is confined to the canvas stage and tuned per theme.

**4. Scope.** Production-ready. Whole surface (graph home + 9 sections restyled). Interactive shipped components.

**5. Layout strategy.** Three zones: slim icon rail, center stage (graph or section content), right inspector on selection. Graph view = collapsible left tree panel + full-bleed canvas + toolbar (search, fit/zoom, layout toggle graph/tree, tag/folder filter, New page).

**6. Key states.** default, loading, empty, offline, error, graph-specific: isolated node, dense hairball (cap + cluster), orphan highlight (from Lint), first-run hint overlay.

**7. Interaction model.** Hover node = highlight neighbors + label; click = select + inspector; double-click = focus subtree; drag = pin; scroll = zoom; background drag = pan; tree click syncs graph selection. Toolbar New page opens Edit prefilled. Lint orphans link into graph.

**8. Content requirements.** Empty: "No pages yet. Create one or run Ingest." Offline: "Start npm start to load the brain."

## Architecture (shipped)

- `src/ui/brain/graph/{types,graph-data,force-graph}.ts` — reusable d3-force canvas engine
- `src/ui/brain/graph-section.ts` — graph home (tree + canvas + toolbar)
- `src/ui/brain/inspector.ts` — right detail panel
- `src/styles/brain-graph.css` — stage glow, motion tokens, rail + inspector
- Section id `graph` (home); legacy `#/app/brain/wiki` still routes to graph
- Dependencies: `d3-force`, `d3-zoom`, `d3-drag`, `d3-selection`

## Tests

- `test/brain/graph-data.test.mjs`
- `test/os/brain-app.test.mts` (markup contract)
- `npm run test:brain`, `npx tsc --noEmit`
