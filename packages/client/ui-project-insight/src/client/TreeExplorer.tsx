/**
 * The left-tree/right-detail explorer the inventory surfaces render: the left
 * pane is the derived group/leaf tree with expand carets, the right pane
 * renders the selected node's JSON payload through the shiki-highlighted
 * CodeBlock, or the caller's leaf body when one is supplied (the agent-tech
 * markdown collections render their documents as markdown). The root opts
 * into the conversation composer overlay, so the panes own their scrollers
 * and stay in place while their content scrolls under the floating composer.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { flattenInventoryTree, firstInventoryLeaf, type InventoryTreeNode } from './tree.ts'
import css from './insight.module.css'

type TreeTranslate = TranslateNS<typeof NS>

/** Full props of the tree explorer: the derived forest, an optional note, an optional leaf body, and locale. */
export interface TreeExplorerProps {
  /** The derived group/leaf forest the left pane renders. */
  readonly roots: readonly InventoryTreeNode[]
  /** A muted line above the tree (e.g. the section's total-vs-emitted count). */
  readonly note?: ReactNode
  /** Renders a selected leaf's right-pane body; group rows always render the JSON payload. */
  readonly renderLeafDetail?: (node: InventoryTreeNode) => ReactNode
  /** The bound namespace translator. */
  readonly t: TreeTranslate
}

/**
 * Render one inventory forest as the explorer: the default selection is the
 * first leaf with its ancestors expanded, a row click selects (and a group row
 * also expands), a caret click toggles, and a selection that a re-scan
 * reshaped away falls back to the first leaf. A selected leaf renders through
 * `renderLeafDetail` when supplied, otherwise through the highlighted JSON.
 * @param props - the derived forest, an optional note, an optional leaf body, and the translator.
 * @returns the two-pane explorer rooted at the composer overlay.
 */
export function TreeExplorer({ roots, note, renderLeafDetail, t }: TreeExplorerProps): ReactNode {
  const flat = useMemo(() => flattenInventoryTree(roots), [roots])
  const defaultLeaf = useMemo(() => firstInventoryLeaf(roots), [roots])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => ancestorsOf(defaultLeaf?.key, flat.parents))
  // A selection the current forest no longer carries (a re-scan reshaped the
  // tree) falls back to the first leaf, mirroring the initial default.
  const current = (selectedKey === null ? undefined : flat.nodes.get(selectedKey)) ?? defaultLeaf

  const select = (key: string): void => {
    setSelectedKey(key)
    // Selecting a group row also reveals its subtree; selecting any row keeps
    // its ancestors open so the selection stays visible.
    const open = new Set<string>(ancestorsOf(key, flat.parents))
    if (flat.nodes.get(key)?.children !== undefined) open.add(key)
    setExpanded(currentSet => (openIsSubset(open, currentSet) ? currentSet : new Set([...currentSet, ...open])))
  }

  const toggle = (key: string): void => {
    setExpanded((currentSet) => {
      const next = new Set(currentSet)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const json = useMemo(
    () => (current === undefined ? '' : JSON.stringify(current.detail, null, 2)),
    [current],
  )

  return (
    <div className={css.treeRoot} data-conversation-composer-overlay="">
      <div className={css.treePane} role="tree">
        {note !== undefined && <div className={css.treeNote}>{note}</div>}
        <div className={css.treePaneScroll}>
          <TreeRows
            nodes={roots}
            depth={0}
            expanded={expanded}
            selectedKey={current?.key ?? null}
            onSelect={select}
            onToggle={toggle}
          />
        </div>
      </div>
      <div className={css.treeDetail}>
        {current !== undefined && (
          <>
            <div className={css.treeDetailHead}>
              <span className={css.treeDetailTitle}>{current.label}</span>
              {current.children !== undefined && (
                <span className={css.muted}>
                  {t('label.count', { count: String(current.children.length) })}
                </span>
              )}
            </div>
            <div className={css.treeDetailScroll}>
              {current.children === undefined && renderLeafDetail !== undefined
                ? renderLeafDetail(current)
                : (
                  <CodeBlock
                    code={json}
                    lang="json"
                    copyLabel={t('label.copy')}
                    copiedLabel={t('label.copied')}
                  />
                )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** The key set covering a key's ancestor chain (empty for roots and absent keys). */
function ancestorsOf(key: string | undefined, parents: ReadonlyMap<string, string>): ReadonlySet<string> {
  const chain = new Set<string>()
  let cursor = key === undefined ? undefined : parents.get(key)
  while (cursor !== undefined) {
    chain.add(cursor)
    cursor = parents.get(cursor)
  }
  return chain
}

/** Whether every key of `open` is already present in `current`. */
function openIsSubset(open: ReadonlySet<string>, current: ReadonlySet<string>): boolean {
  for (const key of open) {
    if (!current.has(key)) return false
  }
  return true
}

/** Render one nesting level of tree rows, recursing into expanded groups. */
function TreeRows({
  nodes, depth, expanded, selectedKey, onSelect, onToggle,
}: {
  nodes: readonly InventoryTreeNode[]
  depth: number
  expanded: ReadonlySet<string>
  selectedKey: string | null
  onSelect: (key: string) => void
  onToggle: (key: string) => void
}): ReactNode {
  return (
    <>
      {nodes.map((node) => {
        const children = node.children
        const open = children !== undefined && expanded.has(node.key)
        const classes = [css.treeRow]
        if (node.key === selectedKey) classes.push(css.treeRowSelected)
        return (
          <div key={node.key} role="treeitem" aria-selected={node.key === selectedKey}>
            <div
              className={classes.join(' ')}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => { onSelect(node.key) }}
            >
              {children === undefined ? (
                <span className={css.treeLeaf} />
              ) : (
                <button
                  type="button"
                  className={css.treeCaret}
                  aria-expanded={open}
                  onClick={(event) => { event.stopPropagation(); onToggle(node.key) }}
                >
                  {open ? '▾' : '▸'}
                </button>
              )}
              <span className={css.treeRowMain}>{node.label}</span>
              {children !== undefined && (
                <span className={css.treeRowCount}>{children.length}</span>
              )}
            </div>
            {children !== undefined && open && (
              <div role="group">
                <TreeRows
                  nodes={children}
                  depth={depth + 1}
                  expanded={expanded}
                  selectedKey={selectedKey}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
