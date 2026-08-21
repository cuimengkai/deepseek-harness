# Capability Market Meta-model

[中文](platform-capability-market.zh.md) | English

> Companion to [platform-architecture.md](platform-architecture.md) (D5, D4): the capability market is the catalog-and-assembly layer that makes a platform capability (plugin + preset + asset schema) discoverable, combinable, and traceable. This spec defines the meta-model — the packaging unit, the catalog entry, and the publish/consume flow — grounded in `examples/platform-agent-demo/`.

## 1. The packaging unit

One capability packages three things (D5):

| Part | Meaning |
|---|---|
| plugin | the tool(s) / service(s) behind the capability |
| preset | the role tool surface the capability contributes |
| asset schema | the data shape the capability produces (see [platform-asset-schema.md](platform-asset-schema.md)) |

A capability is not one of these — it is the triple. `register_asset`, `get_asset`, and the credential tools in the prototype are the demo's capability; each role preset contributes the role surface; each asset kind is the schema.

## 2. The catalog entry

| Field | Meaning |
|---|---|
| `id` | the capability id (plugin name) |
| `name` | display name |
| `role` | which role preset it attaches to |
| `dependencies` | capabilities it requires |
| `conflicts` | capabilities it cannot coexist with |
| `execution` | `managed \| sandboxed \| none` (D4) |
| `version` | the packaged version |

The roster in the prototype is a minimal catalog: it scans the presets dir and lists assembled presets by id (`roster.list()`). A real catalog adds the dependency/conflict/version columns.

## 3. Publish and consume

- **Publish**: the capability author packages the triple and registers the entry. The catalog validates id uniqueness, dependency existence, and schema-kind registration.
- **Consume**: a user picks a role and a capability set; the preset assembler (see [platform-preset-assembler.md](platform-preset-assembler.md)) renders the agent composition; the roster mounts it. The `agent-preset/selected` event records which capability set the agent runs.

## 4. Assembly-time checking

The assembler checks the catalog's dependency and conflict constraints before mounting (id uniqueness, service injection, tool-name shadowing, disabled rows). The market refuses a combination that would produce an agent with two tools of the same name or a missing injected service.

## 5. Two-phase roadmap

- **Phase 1**: the catalog is directory-only — publish registers an entry, consume lists and assembles, no billing. The prototype's roster is this phase.
- **Phase 2**: dependency/conflict resolution becomes explicit, versions are graded, and billing is added (D1, §7 of the architecture). The meta-model's dependency and conflict columns are where that resolution operates.

## 6. Verification

The prototype proves the consume path keyless: the roster scans a catalog, assembles agents by id, recomposes a blank agent onto a preset, and records the selection durably. This spec's additions are the packaging triple, the catalog entry fields, and the publish/consume flow — the D5 follow-up in §9.
