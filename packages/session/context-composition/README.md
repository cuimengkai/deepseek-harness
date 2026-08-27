# @deepseek-ai/dsh-context-composition

English | [中文](README.zh.md)

Host-side read-only projection of one session's current model-visible context, served as `ctx.contextComposition`. `read(session)` folds the durable log's tail into one detached snapshot: the request envelope (system prompt, tool catalog), the priced conversation surface, the newest recorded route capacity, and the compaction history. The browser context view renders this snapshot through the privileged `contextComposition.read` RPC (the envelope row carries the system prompt verbatim — conversation reconnaissance, the same posture as `session.history`).

The fold is pure: `read()` walks an immutable snapshot of the session's events, so the result describes one log revision even while the session keeps appending. The surface rows replay the same surface fold the runtime uses — appends push, replacement ops shadow their inclusive range — so the rows match what the next request is built from. Pricing uses the token-meter's shared estimator (`@deepseek-ai/dsh-token-meter/estimate`), so the figures cannot disagree with the meter's or the `contextBreakdown` projection's vocabulary: the surface and catalog totals are the estimator's own outputs, and the per-tool rows are an advisory same-density split on each tool's JSON.

## Service: `ContextCompositionService` (ctx key: `contextComposition`)

- `read(session)` folds the session's current log tail. The envelope comes from the latest `request/header` event (latest full snapshot wins, so a model or prompt switch restates it); `contextWindow` is the newest `request/context` advertisement, or `null` when no adapter reported one; each `compaction/summary` event records its writer route and the shadow price of the range it replaced. A session with no requests yet reads as a `null` envelope and an empty surface.

No configuration, no events, no mutable state: the service owns nothing but the fold, so its companion registers no runtime invariant (pricing correctness is a pure-function property pinned by unit tests).

## Read result

| Field | Meaning |
|---|---|
| `logRevision` | Durable events consumed for this snapshot (the next unread event seq). |
| `envelope` | Latest header's provider, model, system prompt text, its tokens, per-tool rows, and the catalog total; `null` before any request. |
| `surface` | One row per live surface node in positional order: seq, role, the estimator's price of the exact derived message, and the first text block's first line. |
| `surfaceTokens` | Sum of the surface row prices. |
| `contextWindow` | Newest advertised route capacity, or `null`. |
| `compactions` | One entry per `compaction/summary`: writer model/provider, summary text, shadowed row count, and shadow price. |

See the [`./types` subpath](src/types.ts) — a pure, runtime-import-free module the wire schema and the browser tab both restate, so the vocabulary has one home.

## Model Experience

None, as the projection reads the log and never writes anything the model sees; no event, surface op, or request content is produced.

#### KV Cache effect

None — the fold changes no model request, so cache keys and content are untouched.

## Known Limitations and Deferred Work

- **Per-tool token rows are advisory** — the catalog total is the meter's exact `estimateToolsTokens` figure; a per-tool row uses the same density on the tool's own JSON, so the rows do not sum to the total. The rows rank tools; the total prices them.
- **The fold is O(n) per read** — `read()` walks the whole log; the context view refreshes on surface revisions of live sessions, so long-lived sessions pay a full walk per refresh. A persisted-checkpoint fold (the projection registry's O(1) pattern) is deferred until a real session's read cost shows up.
- **Live sessions only** — the RPC resolves `ctx.sessions`, so a detached (closed) session is not addressable; the tab is a live-session view by design.
