# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Read-only Host projection of the current Cordis Loader tree. `PluginInventoryGateway` registers the `pluginInventory` service and publishes one generated direct Remote, `pluginInventory/list`. Every call reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order with their Loader entry id, module specifier, effective enablement, and current root Fiber phase. When the module name appears in the shipped-spine metadata table (`./spine-meta`), the entry also carries its harness-native `category` and a one-line `description`; user-installed and custom-overlay modules project neither, so the console can group and describe the harness spine without editing the composition layers.

The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. The snapshot is intentionally point-in-time: Loader remains the sole lifecycle authority, while this package owns no cache, history, provenance model, or mutation path. Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

## Live-update event

The gateway also publishes a `plugin-inventory/changed` Host event so mounted consumers refresh without polling. It subscribes to the Loader lifecycle stream (`loader/entry-init`, `loader/partial-dispose`, `internal/plugin`, `internal/status`), coalesces one frame of events into a single microtask emit, and only emits when the recomputed projection actually differs from the last one sent — `internal/status` fires on every fiber transition, which would otherwise flood the wire with no-op change nudges. The event carries no payload; a consumer re-reads `list` to observe the new state. It is a one-way nudge, forwarded verbatim by the [`api-remotes`](../../api/remotes/README.md) allowlist to clients that subscribe.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only inventory projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the result contains no durable failure history; a missing root Fiber is reported as `null`, regardless of why no live root exists. The `changed` event is a nudge, not a payload, and coalesces a frame: several loader transitions yield one event, and a change reverted within the same frame yields none.
- **No provenance or mutation** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot enable, disable, add, or remove plugins.
- **Spine metadata is hand-maintained** — the `spine-meta` table is not gated against the bundle patches; a renamed or removed spine module silently drops its category and description and surfaces uncategorized.
