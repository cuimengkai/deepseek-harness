/**
 * agent-presets domain contract: the roster a browser offers when starting a
 * session, plus the authoring calls behind it.
 *
 * `list` is ordinary: it carries ids and trust, and every preset picker needs
 * it. The authoring calls are privileged and loopback-pinned — a composition
 * names the plugins a session runs, so reading one is reconnaissance, and
 * although authoring is rows-only (no caller supplies composition text or a
 * path), copying, composing, and deleting still rearrange what the deployment
 * offers. A rows payload is validated three ways before the Host writes it:
 * the palette only offers installed plugins, the Host refuses any module the
 * plugin inventory does not confirm installed, and only a locally authored
 * preset is overwritable — the browser edits membership and order, never the
 * plugin set the deployment can run.
 */

import type { FlowGraph } from '@deepseek-ai/dsh-flow/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One preset the deployment can compose a session's agent from. */
export interface AgentPresetEntry {
  /** Stable identifier, also the display name until presets carry metadata. */
  readonly id: string
  /**
   * Whether the preset ships with the deployment or was authored locally.
   * A `user` preset is exactly as privileged as the plugins it names, so a
   * surface offering one should say so rather than present it as vetted.
   */
  readonly trust: 'system' | 'user'
  /** Whether a session that names no preset gets this one. */
  readonly isDefault: boolean
  /**
   * Display name the preset published, absent when it published none. A
   * surface falls back to {@link id}; it is never a second identity, and it
   * never decides trust — a locally authored preset cannot name itself into
   * the shipped set.
   */
  readonly name?: string
  /** One sentence on what the preset is for, when it published one. */
  readonly description?: string
  /**
   * Why this preset cannot compose a session, absent when it can. A broken
   * preset stays listed — its directory still occupies the id, so a surface
   * must be able to show and delete it — but offering it for selection would
   * only defer this reason to a failed session start.
   */
  readonly broken?: string
}

/**
 * One row of a composed agent's plugin list, in composition order.
 *
 * The browser-facing row: a JSON-safe subset of a Loader entry. `config`,
 * `disabled`, and `inject` pass through verbatim — the composer edits
 * membership and order, never row internals — and a `!!js` expression arrives
 * as `{ __jsExpr }` exactly as the Host parsed it. `id` is required by the
 * composer but kept optional here because shipped compositions may carry
 * id-less rows that the Host reads back but the browser cannot author.
 */
export interface ComposeRow {
  readonly id?: string
  /** Exact module specifier the Loader entry imports, e.g. `@deepseek-ai/dsh-tool-bash`. */
  readonly name: string
  readonly config?: unknown
  readonly group?: boolean | null
  readonly disabled?: unknown
  /** Required-service override, carried verbatim so an overwrite never drops it. */
  readonly inject?: unknown
}

/** agent-preset-domain unary methods (the map key agentPreset.* of RpcMethodMap). */
export interface AgentPresetsApi {
  /**
   * Lists every preset the deployment currently supplies, in root-precedence
   * order — the roots as configured, each root's own presets sorted by id,
   * and the first root to supply an id wins. The order is not globally
   * sorted: a user root's preset sits in that root's block, not among the
   * shipped ids.
   * An empty roster means the deployment composes no presets at all, and
   * every session shares the host composition. `authorable` reports whether
   * the deployment configures a root new presets can be written to, and
   * `hasDocument` whether `openDocument` can hand a preset directory to a
   * native opener — both deployment facts rather than per-preset ones, and
   * neither exposes a Host path.
   */
  list(request: RpcRequest<{}>):
  Promise<RpcResponse<{ presets: readonly AgentPresetEntry[]; authorable: boolean; hasDocument: boolean }>>

  /**
   * Recompose one session's agent from a different preset.
   *
   * Allowed only while the session is blank — no turn has run. Once a
   * conversation starts, its history was produced under that preset's tools,
   * and swapping them would leave logged tool calls the new composition cannot
   * make; the attempt answers `agent-preset-locked`.
   */
  select(request: RpcRequest<{ sessionId: SessionId; agentPreset: string }>):
  Promise<RpcResponse<{ agentPreset: string }>>

  /**
   * Read one preset's composition text and structured rows, for the read-only
   * viewer and the rows composer.
   *
   * Privileged: a composition names the plugins a session runs, so reading
   * one is reconnaissance. `rows` are the composition parsed through the
   * Loader's own YAML dialect, so the composer edits structured rows and the
   * browser never parses YAML; `content` stays for the viewer.
   */
  read(request: RpcRequest<{ agentPreset: string }>):
  Promise<RpcResponse<{
    agentPreset: string
    trust: 'system' | 'user'
    content: string
    rows: readonly ComposeRow[]
    name?: string
    description?: string
  }>>

  /**
   * Create a locally authored preset by copying an existing one whole.
   *
   * The directory-copy authoring write. No composition text and no path
   * crosses the wire: `from` and `agentPreset` are ids the Host resolves
   * against its own roots, so a copy is exactly as loadable as its source and
   * grants nothing the roster did not already carry. The copy keeps the
   * source's description (the file is the author's to edit afterwards) but
   * not its name — `name` here or the id fallback is what distinguishes the
   * rows.
   */
  copy(request: RpcRequest<{ from: string; agentPreset: string; name?: string }>):
  Promise<RpcResponse<{ agentPreset: string }>>

  /**
   * Create or replace a locally authored preset's composition from rows.
   *
   * The rows composer. Unlike `copy`, which builds a preset from an existing
   * one's whole directory, `compose` writes exactly the rows it is given —
   * creating a fresh preset under an idle id, or replacing an existing
   * locally authored one in place when `overwrite` is set (a shipped preset
   * is refused: only a locally authored preset is the user's to overwrite).
   * The browser still never supplies composition text or a path, and the Host
   * validates the payload three ways before writing: row structure and unique
   * ids, the resolvability proof that every named module is installed, and —
   * for `overwrite` — that the target is user-authored. `name`/`description`
   * publish beside the composition; the id becomes the preset directory name.
   */
  compose(request: RpcRequest<{
    agentPreset: string
    rows: readonly ComposeRow[]
    name?: string
    description?: string
    overwrite?: boolean
  }>): Promise<RpcResponse<{ agentPreset: string }>>

  /**
   * Read one preset's composition graph, for the graph-backed composer.
   *
   * Privileged for the same reason `read` is — the graph's agent nodes name
   * the plugins a session runs. The graph is the AUTHORING source the canvas
   * edits: each agent node carries the composition row it projects, and the
   * Host regenerates it as a chain when the stored layout is absent or no
   * longer matches the composition (a hand edit or a rows-composer write
   * wins). Structure only — never composition text — crosses the wire.
   */
  readGraph(request: RpcRequest<{ agentPreset: string }>):
  Promise<RpcResponse<{
    agentPreset: string
    trust: 'system' | 'user'
    graph: FlowGraph
    name?: string
    description?: string
  }>>

  /**
   * Create or replace a locally authored preset's composition AND companion
   * graph from a preset composition graph.
   *
   * The graph composer. Rows are derived from the graph's agent nodes and
   * validated exactly as `compose` validates them — non-empty, module-per-row,
   * unique ids, every named module installed, and (for `overwrite`) a
   * user-authored target — then one write commits both the composition and the
   * graph beside it. Structure only, never composition text or a path, crosses
   * the wire; `name`/`description` publish beside the composition and also
   * become the stored graph's name so the roster and the canvas agree.
   */
  saveGraph(request: RpcRequest<{
    agentPreset: string
    graph: FlowGraph
    name?: string
    description?: string
    overwrite?: boolean
  }>): Promise<RpcResponse<{ agentPreset: string }>>

  /**
   * Hand one locally authored preset's DIRECTORY to the platform opener, for
   * editing the files behind the rows composer. The request
   * carries an id, never a path — the Host resolves it — so no browser
   * payload can select an arbitrary filesystem target. Where the deployment
   * has no native opener (`hasDocument: false` on `list`), the reply carries
   * the resolved directory for the surface to show as text instead. Shipped
   * presets are refused: their install is not the user's to manage.
   */
  openDocument(request: RpcRequest<{ agentPreset: string }>, signal: AbortSignal):
  Promise<RpcResponse<{ opened: true } | { opened: false; path: string }>>

  /** Delete a locally authored preset. Shipped presets are refused. */
  remove(request: RpcRequest<{ agentPreset: string }>): Promise<RpcResponse<{}>>
}
