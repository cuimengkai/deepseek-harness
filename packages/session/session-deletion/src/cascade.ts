/**
 * Cascade-scope computation for session deletion: the transitive subagent
 * closure of one root session id over a merged live + persisted header corpus.
 * @module @deepseek-ai/dsh-session-deletion/src/cascade
 */

import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

/**
 * Compute the delete scope of one root session: the root followed by every
 * session whose `parentSession` chain (through `origin === 'subagent'` links)
 * reaches it, in breadth-first pre-order. Only headers carrying
 * `origin: 'subagent'` participate as children, mirroring the subagent
 * listing's lineage rule; a header referencing an absent parent is still
 * traversable (an already-orphaned child is swept). The root itself is always
 * first, whether or not it is a subagent.
 * @param root - the session being deleted.
 * @param headers - the merged live + persisted header corpus to walk.
 * @returns the scope, root first, cycle-safe.
 */
export function cascadeScope(root: SessionId, headers: readonly SessionHeader[]): SessionId[] {
  const children = new Map<SessionId, SessionId[]>()
  for (const header of headers) {
    if (header.origin !== 'subagent' || header.parentSession === undefined) continue
    const siblings = children.get(header.parentSession)
    if (siblings === undefined) children.set(header.parentSession, [header.id])
    else siblings.push(header.id)
  }

  const scope: SessionId[] = [root]
  const seen = new Set<SessionId>(scope)
  for (let cursor = 0; cursor < scope.length; cursor += 1) {
    const parent = scope[cursor]
    if (parent === undefined) continue // noUncheckedIndexedAccess: cursor is always in range
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      scope.push(child)
    }
  }
  return scope
}
