# platform-agent-demo

English | [中文](README.zh.md)

The `product` agent is a product manager that authors requirements and registers them as assets; the `dev` agent reads that requirement and registers the produced code; the `qa` agent verifies the code and registers test cases. The `platform-agent-demo` host plugin and `platform-service` provide the shared asset/credential tools and registry; `mock-llm` is the keyless model route.

A keyless, runnable prototype of the multi-role platform concept in [docs/platform-architecture.md](../../docs/platform-architecture.md). Three role agents share one harness process but expose different model-visible tool surfaces, exchange registered assets across roles, and leave every turn in a durable session log. No `DEEPSEEK_API_KEY` and no network: the `platform-demo` model provider is a scripted in-process adapter.

## Run it

```sh
node --import tsx/esm examples/platform-agent-demo/src/demo.ts
```

The driver boots the host composition, creates a `product` agent (product preset), a `dev` agent (dev preset), a `qa` agent (qa preset), a bare `assembler` agent that the capability market recomposes onto the dev preset, and two quota agents that run one task under different token budgets, drives a turn for each, and prints a JSON summary of the demonstrated mechanisms.

## What it proves

- **In-process engine embedding.** The driver boots the full harness as an in-process library from `cordis.yml` (D3): the host composition mounts the engine plugins and the demo plugin together in one process tree — no separate engine process, no network hop. T1 in `docs/platform-architecture.md`.
- **Role presets isolate tool surfaces.** The product preset mounts no code-world tools; the dev preset mounts `tool-fs` and `tool-bash`; the qa preset mounts read-only inspection only (`tool-fs-search` — `glob`/`grep`). `roleIsolation.devOnlyTools` in the JSON shows the dev difference, and `roleIsolation.qaReadOnlyTools` names the mutators QA lacks (`write`, `edit`, `bash`).
- **Cross-role asset lineage.** The product agent registers a `requirement` asset, the dev agent reads it with `get_asset`, then registers the produced `code` asset, and the qa agent reads the code and registers `test-case` assets. The ids chain `requirement-1 → code-2 → test-case-3` in the tool-call history — the durable lineage `lineage.chainComplete` checks.
- **Full session traceability.** Every turn of every agent appends to the JSONL session log, persisted to disk and read back as `traceability.persistedLogLines`.
- **ACL enforced at the provider boundary.** The dev agent is confined to its own workspace (`workspace-write` sandbox mode, seeded per-session via `applyRolePolicy`). When it attempts to `write` into the sibling product workspace, the sandboxed filesystem fence denies the call with `FS_SANDBOX_DENIED` before the tool runs, and the model-visible result carries the `[sandbox: …]` marker. The denial is durable: the persisted dev-session JSONL records the `FS_SANDBOX_DENIED` error alongside the `pii-leak` write attempt. `aclEnforcement.deniedBy` in the JSON shows the code.
- **Approval seam for AI-execution escalation.** The model retries the denied write with `sandbox_permissions` + a `justification`; `approveEscalation` routes it through `ctx.approval` (the `dsh-user-approval` seam), the scripted answerer grants `allowed-once`, and only then does the write execute. The `approval/asked` + `approval/decided` audit pair lands in the session log (durable, replayable) — the T6 evidence in `approvalEnforcement`.
- **Capability market assembly.** The `agent-presets` roster scans the presets dir as the market catalog and assembles an agent by id. A bare `assembler` agent is created with no preset, then recomposed onto the `dev` preset while still blank: its tool surface gains exactly the dev catalog (`bash`, `edit`, `glob`, `grep`, `read`, `write`), and the durable `agent-preset/selected` event records the swap — the T7 evidence in `marketAssembly`.
- **Per-workspace token quotas under one shared runtime.** Two quota agents run the same task with different `maxTokens` caps while sharing the single harness process. The tight session (24) hits its cap and finishes with `max-tokens`; the loose session (120) completes under its cap. The cap rides the session header into the provider boundary (`requestHeader().config.maxTokens`), so it is a per-session record — the T5 evidence in `quotaEnforcement`.

## Layout

The English layout shows the composition; per-file roles: `cordis.yml` is the host composition, `presets/product/`, `presets/dev/`, and `presets/qa/` are the role presets, `src/demo.ts` drives the three role agents and the bare assembler, `src/mock-llm.ts` is the scripted adapter, and `src/platform-agent-demo.ts` with `src/platform-service.ts` provide the asset tools and registry.

```
cordis.yml
presets/product/
presets/dev/
presets/qa/
src/demo.ts
src/mock-llm.ts
src/platform-agent-demo.ts
src/platform-service.ts
```

## Go live

Swap the agent `provider` from `platform-demo` to `deepseek-official`, mount `dsh-llm-deepseek` (disabled in `cordis.yml`), and supply `DEEPSEEK_API_KEY` to run the same composition against the real model.
