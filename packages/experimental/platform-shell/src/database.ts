/**
 * Lazy Node SQLite loading and filesystem ownership validation for the
 * platform control-plane store.
 * @module @deepseek-ai/dsh-experimental-platform-shell/database
 */

import { lstat, mkdir, open } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Validate the filesystem ownership of one platform database path.
 * @param path - resolved database path (never `:memory:`).
 * @throws when the path is a symbolic link, not owned by the current user, or
 * group/world-accessible.
 */
export async function validateDatabaseFile(path: string): Promise<void> {
  const file = await lstat(path)
  if (file.isSymbolicLink() || !file.isFile()) {
    throw new Error(`platform database "${path}" must be a regular file, not a symbolic link`)
  }
  const uid = process.getuid?.()
  /* v8 ignore start -- Windows exposes neither process.getuid nor meaningful
   * uid/mode bits; POSIX tests cover owner and mode rejection. */
  if (uid !== undefined && (file.uid !== uid || (file.mode & 0o077) !== 0)) {
    throw new Error(`platform database "${path}" must be owned by the current user and accessible only by that user`)
  }
  /* v8 ignore stop */
}

async function validateDatabaseFileIfPresent(path: string): Promise<void> {
  try {
    await validateDatabaseFile(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

let nodeSqlite: Promise<typeof import('node:sqlite')> | undefined

/** Load Node SQLite once so concurrent stores share one warning-filter lifetime. */
function loadNodeSqlite(): Promise<typeof import('node:sqlite')> {
  nodeSqlite ??= importNodeSqlite()
  return nodeSqlite
}

/** Import Node 22's SQLite dependency without its process-wide experimental warning. */
async function importNodeSqlite(): Promise<typeof import('node:sqlite')> {
  const emitWarning = Reflect.get(process, 'emitWarning')
  /* v8 ignore start -- Node 22 alone emits this warning; primary coverage runs on Node 24. */
  const filteredEmitWarning = (warning: string | Error, ...args: unknown[]): void => {
    const message = warning instanceof Error ? warning.message : warning
    const first = args[0]
    const type = warning instanceof Error
      ? warning.name
      : typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null && 'type' in first
          ? first.type
          : undefined
    if (message === 'SQLite is an experimental feature and might change at any time'
      && type === 'ExperimentalWarning') return
    Reflect.apply(emitWarning, process, [warning, ...args])
  }
  Reflect.set(process, 'emitWarning', filteredEmitWarning)
  try {
    return await import('node:sqlite')
  } finally {
    Reflect.set(process, 'emitWarning', emitWarning)
  }
  /* v8 ignore stop */
}

/**
 * Validate the parent directory of one platform database path.
 * @param path - resolved database parent path.
 */
export async function validateParentDirectory(path: string): Promise<void> {
  const parent = await lstat(path)
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error(`platform database parent "${path}" must be a real directory`)
  }
  const uid = process.getuid?.()
  /* v8 ignore start -- Windows exposes neither process.getuid nor meaningful
   * uid/mode bits; POSIX tests cover owner and mode rejection. */
  if (uid !== undefined && (parent.uid !== uid || (parent.mode & 0o022) !== 0)) {
    throw new Error(`platform database parent "${path}" must be owned by the current user and not group/world-writable`)
  }
  /* v8 ignore stop */
}

/**
 * Prepare one platform database path: mkdir its parent and validate ownership.
 * @param path - the configured database path, including `:memory:`.
 * @returns the resolved path used for the connection.
 */
export async function prepareDatabasePath(path: string): Promise<string> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(resolve(actual, '..'), { recursive: true, mode: 0o700 })
    await validateParentDirectory(resolve(actual, '..'))
    await validateDatabaseFileIfPresent(actual)
  }
  return actual
}

/**
 * Load the Node SQLite constructor once (shared warning-filter lifetime).
 * @returns the lazily loaded Node SQLite module.
 */
export function loadSqliteConstructor(): Promise<typeof import('node:sqlite')> {
  return loadNodeSqlite()
}

/**
 * Create one database file with owner-only permissions when absent.
 * @param path - resolved database path.
 */
export async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}
