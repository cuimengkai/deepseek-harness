/** Agent-mode vocabulary shared by discovery, binding, and consumers. */

/**
 * Where a mode directory came from. A `system` mode ships with the
 * deployment; a `user` mode was authored locally and carries the same trust
 * as shell access (it names a preset and runs arbitrary flow graphs).
 */
export type ModeTrust = 'system' | 'user'

/**
 * Ids a mode directory may use.
 *
 * The id becomes a path segment, so this is a containment boundary: `..`, a
 * separator, or an absolute-looking name would place the mode outside the
 * root the deployment authorised.
 */
export const MODE_ID = /^[a-z0-9][a-z0-9-]*$/

/** One mode directory that binds a preset to an entry flow. */
export interface AgentMode {
  /** Stable identifier; the mode directory's name. */
  readonly id: string
  /** Trust recorded from the root this mode was discovered under. */
  readonly trust: ModeTrust
  /** Absolute path of the mode directory. */
  readonly directory: string
  /** Display name from the mode's own metadata; absent falls back to {@link id}. */
  readonly name?: string
  /** One sentence on what this mode is for, when it published one. */
  readonly description?: string
  /** Declared position within its group; absent sorts after those that declare one. */
  readonly order?: number
  /**
   * Why this mode cannot compose a session, absent when it can. A broken mode
   * stays on the roster so its directory can be inspected or deleted, but
   * every resolve path refuses it with this reason.
   */
  readonly broken?: string
}

/** One directory scanned for mode subdirectories. */
export interface ModeRoot {
  /** Directory holding one subdirectory per mode; a leading `~` expands. */
  path: string
  /** Trust recorded on every mode discovered under this root. */
  trust: ModeTrust
}

/** Plugin config: which mode is the default, and where modes live. */
export interface Config {
  /**
   * Mode id resolved when a caller names none and wants a mode. Optional —
   * sessions that omit both `agentMode` and a default stay on the preset path.
   */
  default?: string
  /** Scanned roots in precedence order; an earlier root wins a duplicate id. */
  roots: ModeRoot[]
  /**
   * Prepend this package's bundled shipped modes as a `system` root.
   * Defaults on so the learning sample (`hello-orchestration`) is visible;
   * set false to hide shipped samples.
   */
  includeShippedRoot: boolean
  /**
   * Append the harness home's `USER_MODE_DIR` as a `user` root.
   */
  includeUserRoot: boolean
}

/**
 * No configured root supplies the requested mode.
 */
export class UnknownModeError extends Error {
  constructor(
    /** The id that was requested. */
    readonly modeId: string,
    /** Ids the roster does supply, for the caller to offer instead. */
    readonly available: readonly string[],
  ) {
    super(`agent-modes: mode "${modeId}" not found (available: ${available.join(', ') || 'none'})`)
  }
}

/** A mode exists but its bind or entry flow cannot be used. */
export class ModeInvalidError extends Error {
  constructor(
    /** The mode whose bind failed. */
    readonly modeId: string,
    /** Why it failed, without this package's own message prefix. */
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`agent-modes: mode "${modeId}" is invalid: ${reason}`, options)
  }
}

/**
 * The session's composition is fixed: its conversation has started, so its
 * history was produced under the mode (and bound preset) it runs.
 */
export class ModeLockedError extends Error {
  constructor(
    /** The session whose composition is already fixed. */
    readonly sessionId: string,
    /** The mode that was refused. */
    readonly modeId: string,
  ) {
    super(`agent-modes: session "${sessionId}" has already started; its agent mode is fixed`)
  }
}
