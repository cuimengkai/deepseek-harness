# Agent Note: Agent-preset canvas composer restored after the master merge

Status: implemented

English | [中文](2026-08-29-agent-preset-composer-restore.zh.md)

## Problem

The master merge reconciliation removed the agent-preset composer pipeline: the host package lost `readGraph`/`saveGraph` from the `AgentPresets` service and `conversion.ts` (graph↔rows projection) entirely, `FlowAgentComposition` lost the graph fields, and nine client files (canvas composer, node inspector, model-kind picker, palette, preset-graph helpers) were deleted while the section kept a reduced state that no longer carried `composer`, `view.graph`, `palette`, or `modelCatalog`. The section rendered roster cards with no way to author a preset, and `packages/bundle/web-app/cordis.patch.yml` still mounted the `ui-flow-editor` row whose only purpose is serving the composer's module bytes — a row serving nothing.

## Decision

Restore the full pipeline against the merged architecture rather than transplanting the old one. Host side: `readGraph(agentPreset)` and `saveGraph(agentPreset, graph, name?, description?, overwrite?)` return through the Typert `@Remote` face; `conversion.ts` projects `graphToRows`/`rowsToGraph`; `ComposeRow` and `FlowAgentComposition` carry `JsonValue` (not `unknown`) so the Typert generator accepts the cross-wire data. Client side: `AgentPresetSectionController` composes over the positional `ClientRemote` (`remote.agentPresets.readGraph`, `remote.session.modelCatalog` for the picker catalog, `remote.pluginInventory` for the palette), the section re-gains the composer and read-only design-page branches, and `AgentPresetComposer` requests `@deepseek-ai/dsh-client-ui-flow-editor/client` through `dsh.client.external` — the module-table request the branch's bundle row exists to serve.

## Verification

`packages/preset/agent-presets`: 170 tests passed; `packages/client/ui-agent-preset`: 223 tests passed (the restored section spec asserts the design page, composer gestures, and model-kind routes against a mocked `FlowCanvas`); `tsc -b`, `oxlint`, and the client bundle build pass. `verify-client-packages`, `verify-cordis-config`, and `verify-optional-dependency-imports` stay as red as the pre-change tree (11 baseline violations in packages this change does not touch); the one violation this adds is the composer's module-table request, which the 2026-08-23 cross-package-value policy note forbids for feature packages — see Consequences.

## Consequences

- Drag-and-drop composition, the node inspector with model-kind routes, the read-only shipped-preset design page, and Creator-mode handoff all work again from Settings → Agent.
- The composer is the sole remaining feature-package `dsh.client.external` request. Master's policy directs such sharing through Cordis services; the branch's design instead serves the shared canvas as a component-provider row through the module table. Resolving that conflict (service face for `FlowCanvas`, or a policy carve-out for component-provider rows) is the follow-up this restoration deliberately leaves open.
- `dsh-flow` now depends on `dsh-session` for `JsonValue`; graph-typed data crossing the wire is JSON, not `unknown`.
