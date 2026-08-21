# engine-isolation-demo

English | [中文](README.zh.md)

A keyless, runnable prototype of on-demand physical isolation and the engine process-out seam in [docs/platform-engine-isolation.md](../../docs/platform-engine-isolation.md): a workspace flagged isolated runs its agent drive in a dedicated child engine process whose store and session log live in per-workspace roots, while a shared workspace keeps running in the current process. No `DEEPSEEK_API_KEY` and no network: the `engine-isolation-demo` model provider is a scripted in-process adapter, the child engine runs a one-turn mock-driven drive, and the demo deletes its scratch stores and session logs after it exits.

## Run it

```sh
node --import tsx/esm examples/engine-isolation-demo/src/demo.ts
```

The driver boots the host composition, creates a shared and an isolated workspace, runs an in-process drive (shared) and a process-out drive (isolated), then prints a JSON summary of the demonstrated mechanisms.

## What it proves

- **Routing by the isolation record.** `ctx.engineIsolation.driver` consults `workspaceIsolation`: the shared workspace routes to the in-process engine, the isolated one to the process-out engine, and an unknown workspace fails loud. `routing` in the JSON shows the mapping, and `unknownFailsLoud` proves the loud refusal.
- **A physical process boundary.** The isolated drive runs in a child process spawned via `ctx.subprocess`; the child's reported pid differs from the parent's, and the run handle carries the child's per-workspace store and log roots. `processBoundary` in the JSON shows the two pids.
- **Store separation.** The isolated engine seeds its own world and commits the isolated drive to its per-workspace store: the isolated store holds the isolated workspace and its role, while the shared store holds only the shared workspace's rows. `storeSeparation` in the JSON shows which workspace each store holds.
- **The drive is durable and reconstructable.** The child persists its session log and prints one JSON result line; the parent's `listSessions` and `readLog` read it back, including the persisted `register_asset` tool call and the `platform/workspace/isolated` event the isolated engine emitted. `persisted` in the JSON shows the reconstructable session.
- **Clean teardown.** The demo removes its scratch store and log roots on exit, so a repeat run starts from a clean slate.

## Layout

Per-file roles: `cordis.yml` is the host composition (agent-spine + platform-shell + persistence-jsonl + mock-llm + engine-isolation), `src/demo.ts` drives the shared and isolated runs and asserts the evidence, `src/worker.ts` is the child engine the process-out driver spawns, `src/mock-llm.ts` is the scripted keyless model adapter, and `src/engine-isolation-demo.ts` registers the session→user binding.

```
cordis.yml
src/demo.ts
src/worker.ts
src/mock-llm.ts
src/engine-isolation-demo.ts
```

## Go live

Point `processOut.workerScript` at a real engine assembly, swap the agent `provider` from `engine-isolation-demo` to `deepseek-official`, mount `dsh-llm-deepseek`, and supply `DEEPSEEK_API_KEY` to drive real isolated workspaces. Note that process-out is process-level delegation, not a security boundary — container or VM isolation is a backend swap on the same seam.
