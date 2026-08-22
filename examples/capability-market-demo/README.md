# capability-market-demo

English | [中文](README.zh.md)

A keyless, runnable proof of the capability market and billing ledger in [docs/platform-capability-market.md](../../docs/platform-capability-market.md) and [docs/platform-billing-ledger.md](../../docs/platform-billing-ledger.md), built on the platform control plane of [@deepseek-ai/dsh-experimental-platform-shell](../../packages/experimental/platform-shell/README.md). Five agents share one harness process: the `market-operator` publishes the catalog and closes billing periods, the `product` agent assembles the product-engineering workbench and meters consumption, the `video` agent assembles a short-video-creation workbench with its own capability set, the `market-creator` agent drives the guided preset assembly, and the `market-content` agent mounts the assembled preset. No `DEEPSEEK_API_KEY` and no network: the `market-demo` model provider is a scripted in-process adapter, and the demo deletes its scratch store and session logs after it exits.

## Run it

```sh
node --import tsx/esm examples/capability-market-demo/src/demo.ts
```

The driver boots the host composition, creates two customer-group workspaces, drives one multi-turn chain per agent, then prints a JSON summary of the demonstrated mechanisms.

## What it proves

- **One catalog for three workbenches.** The operator publishes twelve capabilities with dependency, conflict, version, execution, and rate attributes; three scenario bundles register the product-engineering, short-video-creation, and content-marketing workbenches with disjoint capability sets (`workbenches.heterogeneous`).
- **Assembly refuses loudly and fixes restore resolution.** Assembling `test-execution` resolves the transitive chain dependency-first (`code-analysis → test-case-generation → test-execution`); a conflict pair refuses with `CAPABILITY_CONFLICT`, a version-range mismatch with `VERSION_MISMATCH`, and republishing the fixed range restores resolution (`assembly.note`).
- **The execution gate refuses at both assembly and invocation.** Assembly-time: a disabled dependency refuses the assembly that reaches it with `CAPABILITY_DISABLED`, a rollout-0 capability refuses every workspace, and opening the rollout to 1 admits it again. Runtime: the same `analyze_code` call is admitted while `code-analysis` is enabled and refused `CAPABILITY_DISABLED` after the operator disables it between turns — the registered runtime gate re-checks the fresh gate state per workspace at `tools/execute` time (`gating`).
- **The workbench is a per-group binding.** Each customer group's workbench returns its own capability set and preset id, and `roster.mount` binds each agent's scope chain to it — `workbenches.rosterMount` shows `product-engineering`, `short-video-creation`, and the assembled `content-marketing` (a scenario bundle is the served descriptor; page rendering is the web-app layer).
- **The assembler renders + validates a workbench tree before commit.** A creator agent calls `assemble_preset` over the content-marketing workbench; the rendered tree carries the role base plus each selected capability's persona rows in catalog order, the platform-disabled row is reported (`assembly.report.disabledOnPlatform`), and the same request renders deep-equal rows on re-render (`determinism`). A duplicated row id and a shadowed tool name each refuse loudly, so neither tree reaches the roster (`rejections`). The host commits the rendered rows through `AgentPresets.write` and the roster mounts a fresh agent on them; the composed system prompt carries the base persona plus each capability persona in catalog order, minus the disabled row (`mounted`).
- **The billing ledger meters and settles.** The product workspace is credited 100 credits, the two consumes meter 98 (8 + 90), a third consume refuses on `INSUFFICIENT_BALANCE` with the debit rolled back, and the operator settles both periods as `settled` (`billing`).
- **Model-visible ⟺ logged.** Each market tool's `presentationMeta` code lands in the PERSISTED `tool/result` event (`traceability.metaCodes`), and both workbench agents see the same market tool surface (`traceability.uniformlyVisible`).
- **A dangling dependency edge cannot exist.** Unpublishing a capability others depend on is refused by the foreign-key chain (`catalog.canNotOrphan`), which is why `CAPABILITY_DEPENDENCY_MISSING` is unreachable through the service; the nearest reachable refusal — a gated-off dependency — fires `CAPABILITY_DISABLED`.

## Layout

Per-file roles: `cordis.yml` is the host composition, `presets/platform-admin/`, `presets/product-engineering/`, and `presets/short-video-creation/` are the persona-only presets, `src/demo.ts` drives the five agents (including the guided build, its commit through `AgentPresets.write`, and the mounted-agent assertions) and asserts the evidence, `src/mock-llm.ts` is the scripted keyless model adapter, `src/capability-market-demo.ts` registers the market tools with the demo's session→user binding (including the assembler's `resolveBaseRows`), binds sessions to workspaces, and registers the runtime execution gate, and `src/persona-row.ts` is the demo-owned section-configurable persona row the assembly capabilities' preset rows name.

```
cordis.yml
presets/platform-admin/
presets/product-engineering/
presets/short-video-creation/
src/demo.ts
src/mock-llm.ts
src/capability-market-demo.ts
src/persona-row.ts
```

## Go live

Swap the agent `provider` from `market-demo` to `deepseek-official`, mount `dsh-llm-deepseek` (disabled in `cordis.yml`), and supply `DEEPSEEK_API_KEY` to run the same composition against the real model.
