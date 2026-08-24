# Agent Note: The develop-mode insight tabs render cytoscape dependency graphs plus card/table enrichment

Status: implemented

English | [中文](2026-08-24-insight-visualization-cytoscape.zh.md)

## Problem

The develop-mode insight tabs rendered every scanned section as a flat list of sorted rows — functional, but the user's request — "页面的布局和信息展示太简洁丑陋了，不能借助一些第三方可视化展示么" — asks for third-party visualization and richer layout. The six tabs were equally flat, so dependency structure was unreadable at a glance and inventory sections had no visual hierarchy.

## Decision

Render the two dependency sections (module topology, component dependencies) as interactive cytoscape directed graphs and enrich the four inventory sections with cards, badges, and two-column tables. The visualization is a pure client-side derivation over the committed document; the schema, the `projectInsight.read` wire, and the host service are unchanged ([[2026-08-24-insight-per-type-layout]]).

- `graph.ts` holds the pure derivation. `deriveModuleGraph(section, caps)` returns `{ nodes, edges, cycleNodeIds, capped }`: an import counts as an edge only when its target is in the emitted file set, does not start with `external:`, and is not a self-loop; each file's degree is its in-degree plus out-degree within that set, so a shared library ranks first. Nodes cap to the highest-degree paths (`maxNodes: 120`), ties break on path ascending, and edges cap by count after a deterministic sort (`maxEdges: 500`); labels come from the longest matching path-alias prefix. `deriveComponentGraph` renders every component, folds the `section.cycles` mutual-import pairs into the `cycleNodeIds` highlight set, and shares the edge cap. `capped` names what each cap dropped.
- `CytoscapeGraph.tsx` owns one cytoscape instance for its lifetime: pan, zoom, wheel, and tap come free. It rebuilds the instance when the bounded element set changes (cytoscape treats the elements array as the instance's full contents, so a fresh core is simpler than diffing) and destroys it on unmount. The cycle effect reclasses the current instance's elements. Theme colors are resolved from the container's computed design tokens at mount, because cytoscape's canvas renderer does not resolve CSS custom properties; each token has a concrete fallback.
- `InsightTab.tsx` derives the graph in a `useMemo` and renders it above a collapsible `<details>` full list, so a capped or empty graph never hides the underlying data. A one-line caption reports the cap when it dropped anything. The four inventory sections are restructured into `.card` / `.cardHead` / `.table` / `.tableRow` markup with `.badge` chips.
- cytoscape `3.34.0` is a devDependency, inlined into the client bundle by tsdown's `alwaysBundle` rule; it is not an `@deepseek-ai/*` value import, so `dsh-client-bundle-purity` does not object. cytoscape ships its own bundled TypeScript definitions, so `@types/cytoscape` is absent.

## Alternatives considered

- **Keep flat lists** — rejected: it does not answer the user's explicit request for third-party visualization, and dependency structure stayed unreadable.
- **Hand-rolled SVG or D3 force layout** — rejected: pan, zoom, wheel, and tap-to-highlight would be re-implemented and re-tested for no gain; cytoscape provides them and was the user's chosen library.
- **Render every node and edge uncapped** — rejected: large projects would become unreadable; capping keeps the visual usable and the collapsible full list preserves completeness.

## Consequences

- The module and component tabs are now interactive dependency graphs with a collapsible list beneath; the four inventory tabs have cards, badges, and tables. The full list stays one click away.
- The client bundle grows by cytoscape (~0.97 MB CJS / ~210 KB gzip).
- Unit tests do not exercise real cytoscape rendering — jsdom has no canvas — so coverage targets the pure derivation (node order, caps, cycle set, alias labels) and a mocked-cytoscape mount (elements, layout, stylesheet selectors, cycle classes, destroy).
