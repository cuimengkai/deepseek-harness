# Agent Note: Route isolated workspaces to a dedicated child engine process

Status: implemented

English | [中文](2026-08-22-engine-isolation.zh.md)

## Problem

The platform-architecture doc makes the workspace the isolation unit with physical isolation optional (D2), and reserves the engine process-out seam at the interface — `DriveAgentRun` / `ListSessions` / `ReadLog` as the driver seam (D3). The seam was reserved but unimplemented: every agent run is in-process through `AgentFactory`, and no package owned the routing between a workspace's isolation demand and the engine that runs its drives. The platform-shell control plane owns the workspace record, so the missing piece was the adapter-layer engine seam.

## Decision

`packages/experimental/engine-isolation` is a private source-only experimental package owning the D3 driver seam: `EngineDriver` with `drive` / `listSessions` / `readLog`, an in-process engine (caller-supplied runner), a process-out engine (a child engine process spawned through `ctx.subprocess` with per-workspace store and JSONL log roots), and a router that consults `ctx.platformShell.workspaceIsolation(workspaceId)`. The isolation record itself lives on the platform-shell control plane (schema v3 `workspaces.isolated`, flipped by `createWorkspace(name, {isolated})` and `setWorkspaceIsolation` under the `platform.isolation` permission); engine-isolation is the engine seam that reads it. `examples/engine-isolation-demo` proves routing by the isolation record, the physical process boundary, store separation, and log reconstructability keylessly.

The process-out child boots the platform-shell assembly at its per-workspace store path, seeds the isolated world, runs a one-turn mock-driven drive, persists its session log, and prints one JSON result line on stdout before exiting. Session persistence is file-backed and process-agnostic, so the parent's `readLog` and `listSessions` read the child's durable JSONL directly. The engine that ran an isolated drive emits the log-only `platform/workspace/isolated` session event as the per-session projection of the control-plane isolation flip; the event carries no model tokens.

Process-out is process-level delegation, not a security boundary: the child shares the host machine, kernel, and filesystem access policy. Container or VM isolation is a backend swap on the same seam (the e2b family is the remote-VM backend) and is deferred. Isolation is per-workspace, not per-request: the flag lives on the workspace record and flips via the service, with no model-facing tool to flip it mid-session.

## Alternatives considered

**Route every workspace process-out.** In-process keeps the data plane reachable and permissions plugged into the enforcement point, the D3 MVP rationale; process-out costs more and is the upgrade form, so it stays the isolated-workspace path.

**Route on a per-request flag.** The isolation unit is the workspace (D2); a per-request flag would fragment a workspace's store and audit story across processes.

**Use the e2b remote-VM backend for physical isolation now.** It needs `E2B_API_KEY` (violating the keyless constraint) and is composition-static, not per-workspace; the process-out seam keeps it as a later backend swap.

## Consequences

The engine seam is host-supplied: the in-process runner closure and the process-out worker script are obligations of the mounting host, while the seam owns driving and routing, not assembly. The process-out protocol requires the worker to persist and print one result line; a non-zero exit or a missing line fails the drive loudly with `ENGINE_SPAWN_FAILED`, never silently. Both packages are private source-only experimental packages no release package depends on, so the seam types and the session event are not part of the published SDK.
