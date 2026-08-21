# Lineage Bridge Data Model

English | [中文](platform-lineage-bridge.zh.md)

> Companion to [platform-architecture.md](platform-architecture.md) (D7): the lineage bridge connects business-object tables and session-log events through reference relations. This spec defines the bridge's data model — the reference event, the lineage table, and the query semantics — grounded in `examples/platform-agent-demo/`.

## 1. Two sides of the bridge

- **Business-object side**: the platform's own store holds `PlatformAsset` records (see [platform-asset-schema.md](platform-asset-schema.md)). Each record is durable and has a stable `id`.
- **Session-log side**: the dsh session log records every AI-visible input and output. AI behavior that touches a business object writes a **reference event** naming that object's `id`.

The bridge is the join: an event row in the session log points at a business-object id, and the lineage table records the relation so a query can walk from any object to its ancestors and descendants.

## 2. The reference event

When an agent reads or produces a business object, the session log carries a reference:

| Field | Meaning |
|---|---|
| `type` | the event type, e.g. `asset/read`, `asset/register` |
| `assetId` | the referenced `PlatformAsset.id` |
| `kind` | the asset kind (requirement, code, …) |
| `role` | the acting role |

The reference is model-visible input, so it is **logged**: the `Model-visible ⟺ logged` invariant holds. The prototype writes tool calls carrying the id (`get_asset { id: 'code-2' }`); the reference event is the durable projection of that call.

## 3. The lineage table

The platform's business store keeps a `lineage` relation:

| Column | Meaning |
|---|---|
| `asset_id` | the descendant asset |
| `parent_id` | the asset this one derived from (nullable) |
| `role` | the producing role |
| `created_at` | when the relation was recorded |

One asset may have many parents (a design references several requirements); the relation is a many-to-many edge table, not a single column on the asset.

## 4. Query semantics

- **Ancestors(id)**: walk `parent_id` transitively toward the source — `test-case-3 → code-2 → requirement-1` in the prototype.
- **Descendants(id)**: the reverse walk, from a requirement down to the test cases that ultimately verify it.
- **Cross-role trace**: because every edge records the producing role, a walk yields the role sequence — product → dev → qa — which is the "who produced what for whom" answer the platform's core selling point promises.

## 5. Construction guarantee

The bridge is constructive, not best-effort: any model-visible input in the session log that references a business object has its reference event; any reference event names an existing asset id. The prototype's `lineage.chainComplete` asserts exactly the constructed chain `requirement-1 → code-2 → test-case-3`.

## 6. Verification

The prototype demonstrates the write path keyless: three roles produce three assets and the reference chain is recorded and asserted. This spec's additions are the lineage table shape, the many-to-many edge semantics, and the ancestor/descendant queries — the D7 follow-up in §9.
