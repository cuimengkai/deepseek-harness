# Agent Note: Render and validate a workbench preset before commit

Status: implemented

English | [中文](2026-08-22-preset-assembler.zh.md)

## Problem

Phase 4's low-code direction identifies the preset assembler's render + validate-before-commit step as the linchpin gap ([docs/platform-preset-assembler.md](../../../../docs/platform-preset-assembler.md)): a workbench reaches the roster only through a hand-authored role preset or an operator-driven agent call, never through a machine-validated render from a declared capability set. Two seams were missing: the market catalog carried no preset fragment a capability contributes to a workbench tree, and the agent-presets "no caller supplies composition text" authoring boundary left no sanctioned way to commit a rendered tree.

## Decision

The platform-shell package owns the assembler as a pure in-package module (like `execution-gate.ts`): `renderPresetTree(base, resolved, patches, warn)` appends each selected capability's `rows` fragment to the role preset's base rows in catalog order and applies the overlay patches by reusing `applyEntryPatches` from `@deepseek-ai/cordis-plugin-include` (detached result, id-targeted, warn sink — deterministic, so the same request renders deep-equal rows); `validatePresetTree(rows, platform)` reports rows disabled for the current platform (`disabledOnPlatform`) and refuses duplicate row ids (`ROW_ID_CONFLICT`); `assertNoToolShadowing(resolved)` refuses a tool name owned by two capabilities (`TOOL_NAME_CONFLICT`) — the catalog `capability_tools` PK is per-capability with no global uniqueness and the owning lookup is `LIMIT 1` without `ORDER BY`, so a shadowed name would otherwise have a non-deterministic owner. The service method `assemblePreset` requires `capability.consume` membership within the scenario, resolves the selection, renders and validates, and writes one `market.preset.assemble` audit row.

The `assemble_preset` tool exposes the seam to agents: the host supplies a `resolveBaseRows` binding that reads the role preset from the roster and parses its entry-list YAML (REQUIRED — the tool fails loud with `INVALID_ARGUMENT` without it), and the tool appends the durable `preset/assembled` session event carrying the rendered rows (model-visible ⟺ logged) before returning the tree plus the validation report.

The commit boundary relaxes deliberately. Capabilities gain a `rows` fragment in the publish request (schema v5; old on-disk v4 formats are rejected per the pre-release stance), validated per row at publish. The agent-presets package gains a sanctioned `AgentPresets.write(id, rows, meta)` primitive that validates the id, refuses occupied or shipped ids, dumps the rows with the entry-list YAML dialect (so `!!js` disabled nodes round-trip evaluable), publishes the metadata, tightens POSIX modes, and atomically writes — the assembler is the sanctioned authoring client, mirroring `copyComposition` from rows.

`examples/capability-market-demo` proves the seam keylessly: a non-operator creator agent calls `assemble_preset` over the content-marketing workbench; the host commits the rendered rows through `AgentPresets.write` and mounts a fresh agent, and the composed system prompt carries the base persona plus each capability persona in catalog order minus the platform-disabled row; a duplicated row id and a shadowed tool name each refuse loudly before any tree can reach the roster; and the same request renders deep-equal rows on re-render.

## Alternatives considered

**Reuse `applyEntryPatches` from `cordis-plugin-include`.** A hand-rolled overlay merge would re-implement id-targeted patching and the `%C` warn codes; the maintained helper deletes owned code and tests and is the documented rendering path.

**Validate tool shadowing in the assembler.** Without a global tool-name registry, a name owned by two capabilities resolves through the `LIMIT 1` owning lookup to a non-deterministic owner; refusing the combination before commit is the only place the ambiguity is visible, so the conflict must reject there rather than surface as flaky call-time behavior.

**Report, not reject, platform-disabled rows.** A row disabled on the current platform is an expected surface delta, not a conflict; the report lets the host show it, while loader-level checks (`inactiveRows`/`leakedServices`) stay at roster mount.

**Relax the authoring boundary with a sanctioned `write`.** Keeping the copy-only boundary would leave a rendered tree uncommittable; `write` is a deliberate, documented relaxation with the assembler as the sanctioned client, mirroring `copyComposition` from rows.

## Consequences

The assembler renders and validates but never commits — the roster is a host action, so the seam stays one-directional (platform-shell never reads the roster) and loader-level checks stay at mount. `assemble_preset` requires the consumer's `resolveBaseRows` binding and fails loud without it, and the `preset/assembled` event's rows are durable reconstruction for any model-visible tree. The `rows` publish-request field is new schema (v5) and a capability with no rows contributes nothing to a tree. The design spec, the low-code evaluation, the capability-market meta-model, and the platform-shell and demo READMEs now record the step as implemented; the remaining low-code follow-ups are the per-capability options surface and the user-side workbench lifecycle.
