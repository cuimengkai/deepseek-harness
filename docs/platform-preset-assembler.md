# Preset Assembler Design

English | [中文](platform-preset-assembler.zh.md)

> Companion to [platform-architecture.md](platform-architecture.md) (D5, D2, T7): the assembler turns a role plus a chosen set of capabilities into a runnable agent composition. This is a design spec for the follow-up listed in §9, grounded in the keyless prototype at `examples/platform-agent-demo/`. The render + validate-before-commit step (§3, §4) is implemented in the `preset-assembler` module of `@deepseek-ai/dsh-experimental-platform-shell` and proven keyless by the capability-market demo's guided build.

## 1. Problem

A preset is a static `agent.cordis.yml` tree under a role directory. The capability market (D5) promises end users can "assemble capabilities freely": pick a role, pick capabilities, get an agent. A hand-edited preset per combination does not scale — the market must **render** a preset config from a role template plus capability choices, then **validate** the result before mounting.

## 2. Inputs and output

| Input | Meaning | Source |
|---|---|---|
| Role | the role's base tool surface and persona | role preset directory |
| Capability set | chosen capabilities plus options | market catalog selection |
| Context | workspace, session defaults, quota | workspace record |

Output: a **preset config tree** (`cordis.yml` rows plus persona text) that the roster mounts onto a fresh agent session.

## 3. Assembly algorithm

1. **Base**: copy the role's rows (identity, base tool rows) from the role preset.
2. **Append**: add each chosen capability's rows after the base, in catalog order.
3. **Overlay**: apply per-capability options and workspace context (cwd, quota) as config patches.
4. **Validate**: run the config through the same checks the loader uses — plugin ids resolve, injected services exist, no row duplicates by id, no disabled-on-this-platform row silently missing a sibling.
5. **Commit**: emit the rendered tree as the preset for `roster.mount`.

The roster's `recompose` on a blank session is the live form of the same algorithm: the capability market assembled the dev preset onto the bare assembler agent in the prototype, and the durable `agent-preset/selected` event records the outcome.

## 4. Dependency and conflict checking

- **Id uniqueness**: two rows mounting the same plugin id into one agent is a conflict; the market rejects the combination before mounting.
- **Service injection**: a capability whose rows inject a service the role does not mount fails validation unless the capability declares the service itself.
- **Tool-name shadowing**: two capabilities registering the same model-facing tool name is a conflict; the catalog keeps a name registry.
- **Disabled rows**: a row disabled on the current platform (e.g. `tool-pwsh` off macOS) is not a conflict, but the assembler reports it so the user sees the surface delta.

## 5. Rendering vs hand-authoring

Rendering is deterministic: same role, same capability set, same context — same tree. Hand-authored presets remain valid inputs; the assembler normalizes them to the same rendered form so market and hand-authored agents behave identically. The prototype's three role presets (`product`, `dev`, `qa`) are hand-authored; a future market renders them from role templates plus capability rows.

## 6. Verification

The prototype proves the mechanism end to end keyless: `roster.mount` assembles by id, `roster.recompose` swaps a blank agent onto another preset, and the resulting tool surface is exactly the preset's rows (`roleIsolation`, `marketAssembly` in the demo JSON). The implementation adds the validate-before-commit step: `assemble_preset` renders the base-plus-capabilities tree through `renderPresetTree` — deterministic, so the same request renders deep-equal rows — reports rows disabled for the current platform, and refuses a duplicate row id (`ROW_ID_CONFLICT`) or a shadowed tool name (`TOOL_NAME_CONFLICT`) before any tree can reach the roster. The capability-market demo's guided build commits the rendered rows through `AgentPresets.write`, mounts them, and asserts the composed system prompt carries the base persona plus each capability persona in catalog order, minus the platform-disabled row.
