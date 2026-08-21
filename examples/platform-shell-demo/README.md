# platform-shell-demo

English | [中文](README.zh.md)

A keyless, runnable prototype of the platform control plane in [docs/platform-architecture.md](../../docs/platform-architecture.md): tenant/RBAC, a business-object asset store with lineage, a business-approval flow, and an audit log — all over ONE file-backed SQLite database, driven entirely by role agents. Five agents share one harness process: the `product`, `dev`, `qa`, and `platform-admin` role agents drive the store, and a bare `mallory` agent proves RBAC denial. No `DEEPSEEK_API_KEY` and no network: the `platform-demo` model provider is a scripted in-process adapter, and the demo deletes its scratch store and session logs after it exits.

## Run it

```sh
node --import tsx/esm examples/platform-shell-demo/src/demo.ts
```

The driver boots the host composition, creates one workspace with four members and one non-member, drives one turn per role agent, then prints a JSON summary of the demonstrated mechanisms.

## What it proves

- **In-process engine embedding.** The driver boots the full harness as an in-process library from `cordis.yml`: the host composition mounts the engine plugins, the control-plane service, and the demo plugin in one process tree — no separate engine process, no network hop. T1 in `docs/platform-architecture.md`.
- **A control plane over one SQLite file.** The `platform-shell` service is the durable business-object store (tenant/RBAC + asset store + lineage + business approval + audit) over a single file-backed database. The demo overrides `path` with a scratch file, so the store is durable across the run and removed afterward.
- **Cross-role asset lineage.** The product agent registers a `requirement` asset, the dev agent reads it with `get_asset`, registers the produced `code` asset and links it, and the qa agent reads the code, registers `test-case` assets, and links them. The ids chain `requirement-1 → code-2 → test-case-3` — the durable `lineage.chainComplete` checks.
- **Business approval driven by agents.** The product agent submits the requirement ticket and drives it `draft → review → approved`, holding a `product` review scope; the platform-admin agent lists the ticket and releases it `approved → released`. Every step lands both in the store and as a `platform/approval/transition` session event — `approval.chain` checks the exact `null→draft → draft→review → review→approved → approved→released` chain.
- **RBAC enforced at the service boundary.** `mallory` is a registered user but deliberately not a workspace member. Her `get_asset` read returns `PERMISSION_DENIED` before any store access, and the denial is durable — her persisted JSONL session log records the `PERMISSION_DENIED` tool error. `rbacDenial.deniedPersisted` in the JSON shows the code.
- **Every mutation pairs with one audit row.** Each commit writes one audit row in the same transaction; `asset.register` reaches 3, `asset.read` 2, and `lineage.link` 2 — while mallory's denied read writes none. `audit.byAction` in the JSON shows the counts.
- **Model-visible ⟺ logged.** Each platform tool's `presentationMeta` code lands in the PERSISTED `tool/result` event, not just the in-memory one — `traceability.metaCodes` proves every tool call and result is reconstructable from the persisted JSONL session logs.
- **The invariant companion validates replay.** Every committed `asset/read`, `asset/register`, and `platform/approval/transition` event is checked against the control-plane store, so a replayed session cannot name an asset or status the store does not hold.
- **The control-plane surface is uniform across roles.** All five agents — including the bare mallory — see the same ten platform tools (`controlPlaneSurface.uniformlyVisible`), because RBAC, not tool mounting, is the access boundary. The fs/shell isolation the sibling `platform-agent-demo` proves is intentionally not repeated here.

## Layout

Per-file roles: `cordis.yml` is the host composition, `presets/product/`, `presets/dev/`, `presets/qa/`, and `presets/platform-admin/` are the persona-only role presets, `src/demo.ts` drives the five agents, `src/mock-llm.ts` is the scripted keyless model adapter, and `src/platform-shell-demo.ts` registers the platform tools with the demo's session→user binding.

```
cordis.yml
presets/product/
presets/dev/
presets/qa/
presets/platform-admin/
src/demo.ts
src/mock-llm.ts
src/platform-shell-demo.ts
```

## Go live

Swap the agent `provider` from `platform-demo` to `deepseek-official`, mount `dsh-llm-deepseek` (disabled in `cordis.yml`), and supply `DEEPSEEK_API_KEY` to run the same composition against the real model.
