# Agent Note: Flow engine mounted on the shipped Web host plane

Status: implemented

English | [中文](2026-08-23-flow-engine-host-mount.zh.md)

## Problem

The flow engine `@deepseek-ai/dsh-flow` was built and tested (compile/validate/run suites, the flow-demo fixture) but never mounted in any shipped composition, and the Web bundle even overrode the base's `workflow-worker-thread` row to `disabled: true`. So the product's Flow tab — the canvas — answered every `flow.*` RPC with `flow-unavailable` and rendered a read-only notice: the canvas could not drag because there was no engine behind it.

## Decision

The engine joins the shipped Web composition as a host-plane row.

1. **A `flow` row in web-app's `- insert:` block** mounts `@deepseek-ai/dsh-flow` (`packages/bundle/web-app/cordis.patch.yml`), and the web-app override that disabled the base's `workflow-worker-thread` row is removed. `@deepseek-ai/dsh-flow` joins the `packages/bundle/web-app` and `apps/cli` dependencies so row resolution finds it from both the bundle and the dsh app.

2. **Host-plane ownership.** The engine stays on the host plane: all eight `flow.*` RPCs resolve `ctx.get('flowEngine')` on the host, six of them session-less. The session's own workflow tool still comes from its preset's `tool-workflow` row; the host engine is a separate realm, and re-enabling `workflow-worker-thread` adds a host service, not a session tool, so the shipped tool catalog is unchanged.

3. **Row ordering is load-bearing.** The engine resolves `workflowEngine` through `ctx.get` at construction and throws `FLOW_ENGINE_ABSENT` when absent, so the `flow` row must mount after the base's `workflow-worker-thread`. It is listed inside the `- insert:` block because a patch row must target an existing id to apply — a top-level `- id: flow` patch is skipped by `applyEntryPatches` as a no-target warning (`vendor/include/src/index.ts`). Inserted rows append behind the base tree, so `flow` always mounts after the base's enabled `workflow-worker-thread` by construction.

4. **The `./types` subpath points at a real runtime module.** It declared `default: ./lib/types.js`, a tsdown bundle the workspace entry glob (`lib/types/{index,invariant,startup}.js`) never emits, so a built consumer importing `@deepseek-ai/dsh-flow/types` at runtime (the api-proxy's `FlowRunId`) failed to load. The export now mirrors the repo convention — `default: ./lib/types/types.js`, the tsc-emitted module inside `lib/types/` — and `files` carries `lib/types/**/*.js` instead of the nonexistent bundle. `FlowId`, `FlowRunId`, and `FLOW_FORMAT_VERSION` keep their home in `src/types.ts`, consistent with other packages that keep small runtime constants there.

## Alternatives considered

- **A top-level `- id: flow` patch row** — skipped: `applyEntryPatches` drops non-insert patches whose id has no target with a warning, which is why every web-only row in the bundle lives in the `- insert:` block. Found because the row silently failed to appear in the loader entries.
- **Add `types` to the workspace tsdown entry glob** — would emit a `lib/types.js` bundle for every package, mostly near-empty because most `src/types.ts` files are types-only; rejected as repo-wide churn for one consumer.
- **Move the brand factories out of `types.ts`** — the packages rule says `src/types.ts` is types-only, but other packages already keep small runtime constants there (session, workflow, fs), and the runtime module the subpath needs already exists as tsc output; repackaging was unnecessary.

## Consequences

- The Flow tab is live in the shipped Web composition; the read-only notice remains the fallback for a custom composition that omits the engine.
- The stale `develop` preset expectation in `web-agent-presets.e2e.ts` was corrected to include the shipped preset added by the develop-mode insight feature.
- No model-visible input changed, so no snapshot is due.
