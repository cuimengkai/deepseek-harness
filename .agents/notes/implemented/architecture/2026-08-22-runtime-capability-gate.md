# Agent Note: Enforce the capability gate at execution time

Status: implemented

English | [中文](2026-08-22-runtime-capability-gate.zh.md)

## Problem

Roadmap Phase 2's "Restricted execution (gated per capability on a gray-release basis)" was only half-realized: the execution gate (`enabled` / `rollout`) was enforced at assembly time — `resolveCapabilities` and `consumeCapability` refused a disabled or rollout-excluded capability loudly, and enforcement was the gated capability's absence from the mounted composition. A tool whose owning capability was flipped disabled after assembly still ran, because nothing re-checked the gate at invocation time. The platform-shell README's Known Limitations named the gap: "Gating is assembly-time, not runtime."

## Decision

The platform-shell package owns a runtime execution gate: `registerCapabilityExecutionGate(ctx, { resolveWorkspace })` registers a `tools/execute` waterfall listener that, per call, resolves the tool's owning capability through the fresh store read `runtimeCapabilityOwningTool(toolName)` (a reverse lookup over the new `capability_tools` table, schema v4) and throws `CAPABILITY_DISABLED` when the gate is closed for the calling session's workspace. The `tools/execute` runtime surfaces the thrown error as an error result carrying that code, so the block lands at dispatch. The read joins the live gate row — it never caches, so an operator's gate flip takes effect on the next call. Unowned tools and non-agent executions delegate unchanged; the host supplies the session→workspace binding and owns the loud `UNKNOWN_WORKSPACE` failure for a session with no workspace.

`publishCapability` now records the tool names each capability governs (`tools`), validated non-empty; the `capability_tools` rows cascade with the capability. `examples/capability-market-demo` proves the block keylessly: the same `analyze_code` call is admitted while `code-analysis` is enabled and refused `CAPABILITY_DISABLED` after the operator disables it between turns, reconstructed from persisted `tool/call`↔`tool/result` pairs.

## Alternatives considered

**Check the gate inside each tool body.** Every platform tool would need to know its owning capability and duplicate the gate logic; the waterfall keeps it in one place and covers demo-owned and third-party tools whose capability is published to the market.

**Filter gated tools out of the model's tool surface.** That is the assembly-time behavior already shipped; it cannot block a tool that was mounted while open and is disabled later, which is exactly the gray-release case.

**Reuse the assembly-time resolver at call time.** Resolution answers "may this workspace assemble this capability", not "may this tool run now"; the reverse lookup answers the per-tool question directly and reads one row.

## Consequences

The runtime block is an opt-in registration, not the default: a host that wants it must register the gate and supply its session→workspace resolver; without it, a gated tool is still enforced only by its absence from the mounted composition. The gate semantics are shared — the same `assertGateOpen` (enabled plus deterministic rollout fraction) refuses at both assembly and invocation, so a gray-release hold applies to execution too. The governed tool surface is a capability attribute, so the market catalog carries it and the enforcement read is a single join; the execution-gate spec and the package README document the opt-in and the new service method.
