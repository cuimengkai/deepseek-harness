# Asset Schema Specification

[中文](platform-asset-schema.zh.md) | English

> Companion to [platform-architecture.md](platform-architecture.md) (D5, D7): the schema-ified asset is one third of the capability packaging unit (plugin + preset + asset schema). This spec defines the asset record, its kinds, the id scheme, and the projection rules — grounded in `examples/platform-agent-demo/` and its `platformService`.

## 1. The asset record

Every produced artifact on the platform is a `PlatformAsset`:

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | durable, unique, kind-prefixed (see §3) |
| `kind` | `string` | the artifact category (see §2) |
| `content` | `string` | the AI-readable projection of the artifact |
| `role` | `string` | the producing role |

The record is the unit the lineage bridge references (§5 of the companion spec). It is stored by the platform's own business-object store, never inside the dsh session log.

## 2. Asset kinds

The MVP lane fixes a closed set, extensible by merge-extensible registration:

| kind | producer | content is |
|---|---|---|
| `requirement` | product | the requirement text |
| `design` | ui | the design decision and references |
| `code` | dev | the implemented code summary and file map |
| `test-case` | qa | the derived test cases |
| `handoff` | any | the cross-role handoff note |

Kinds are checked at the tool boundary: `register_asset` validates the kind against the registered set and rejects unknown kinds loud.

## 3. Id scheme

`<kind>-<sequence>`, where the sequence is monotonic per store — `requirement-1`, `code-2`, `test-case-3` in the prototype. The id is durable: the role that produces the asset hands the id to the next role, which reads it back with `get_asset`, and the lineage bridge records the reference. A kind prefix keeps the id self-describing in tool-call history and session logs.

## 4. Content projection

`content` is the AI-readable projection, not the artifact's full bytes. Design documents, snapshots, and large files live in object storage; the asset carries a pointer plus a summarized projection the next role can act on. The projection is role-scoped: a dev reads a requirement's intent, not its raw meeting notes. The prototype demonstrates the projection discipline — `content` strings are concise summaries (`Login page with SSO`, `Implemented login page (SSO) in src/`).

## 5. Merge-extensible registration

New kinds register through the same merge-extensible mechanism the repo uses for event and schema maps: a plugin declares the kind, its producer role, and its projection rule in one place, and the validation gate accepts it once registered. Unknown kinds fail registration, so a producer cannot silently invent a kind the lineage bridge does not understand.

## 6. Verification

The prototype exercises the record end to end keyless: three roles produce three kinds, the ids chain `requirement-1 → code-2 → test-case-3`, and `lineage.chainComplete` in the demo JSON asserts the chain. This spec's additions are the closed kind set with loud rejection, the object-storage pointer rule, and the merge-extensible registration — the D5 follow-up in §9.
