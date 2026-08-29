/**
 * Session results column (WorkBuddy-style right rail): artifacts, changes,
 * files, and the legacy tool-call inspect surface.
 */

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { DetailsSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot, RunningToolCall, ToolCallBlock, ToolResultNode } from '../contract/snapshot.ts'
import { findToolCall } from './tool-node-reader.ts'
import css from './DetailsPanel.module.css'

export type DetailsPanelProps = DetailsSlotProps

type ResultsTab = 'artifacts' | 'changes' | 'files' | 'inspect'

/** Structural read of deliverables Turn data without coupling to ui-deliverables. */
interface ProducedTurnData {
  readonly produced: readonly { readonly path: string }[]
}

/** The snapshot-owned block reference must remain stable across unrelated frames. */
interface CallMaterial {
  name: string
  argsRaw: string | null
  block: ToolCallBlock
}

function settledMaterial(node: ToolResultNode, callId: string): CallMaterial {
  return { name: node.call?.name ?? callId, argsRaw: node.call?.argsRaw ?? null, block: node }
}

function runningMaterial(call: RunningToolCall): CallMaterial {
  return { name: call.name, argsRaw: call.argsRaw, block: call }
}

function materialFor(s: ChatSnapshot, callId: string): CallMaterial | null {
  const found = findToolCall(s, callId)
  if (found === undefined) return null
  return 'kind' in found ? settledMaterial(found, callId) : runningMaterial(found)
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** Flatten a settled result for the no-ui-tool fallback. */
function rawResultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

/**
 * Unique mutation paths across loaded turns (first-seen order).
 * @param snapshot - chat target snapshot.
 * @returns produced paths.
 */
export function sessionProducedPaths(snapshot: ChatSnapshot): readonly string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const turn of snapshot.timeline.turnOrder) {
    const store = snapshot.timeline.turns.get(turn)?.data as { get(key: string): unknown } | undefined
    const data = store?.get('deliverables') as ProducedTurnData | undefined
    if (data === undefined) continue
    for (const produced of data.produced) {
      if (seen.has(produced.path)) continue
      seen.add(produced.path)
      paths.push(produced.path)
    }
  }
  return paths
}

/**
 * Trailing path segment for compact list rows.
 * @param path - file path.
 * @returns basename.
 */
function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * Render the session results column.
 * @param props - details slot props.
 * @returns panel.
 */
export function DetailsPanel({
  useChat, useSessions, sessionId, useStore, renderSlot, closeDetails, openFile, t,
}: DetailsPanelProps): ReactNode {
  const selection = useStore(s => s.selection)
  const sessionCwd = useSessions(list => list.byId[sessionId]?.cwd)
  const callId = selection?.callId
  const material = useChat(
    s => (callId === undefined ? null : materialFor(s, callId)),
    (a, b) => shallowEqual(a, b),
  )
  const produced = useChat(sessionProducedPaths, shallowEqual)
  const [tab, setTab] = useState<ResultsTab>('artifacts')

  useEffect(() => {
    if (selection !== null) setTab('inspect')
  }, [selection])

  useEffect(() => {
    if (produced.length === 0) return
    if (selection !== null) return
    setTab(current => (current === 'inspect' ? 'artifacts' : current))
  }, [produced.length, selection])

  const tabs: { id: ResultsTab; label: string; count?: number }[] = [
    { id: 'artifacts', label: t('results.tab.artifacts'), count: produced.length },
    { id: 'changes', label: t('results.tab.changes'), count: produced.length },
    { id: 'files', label: t('results.tab.files') },
    { id: 'inspect', label: t('results.tab.inspect') },
  ]

  return (
    <div className={css.root} data-results-panel="">
      <div className={css.header}>
        <div className={css.title}>{t('results.title')}</div>
        <button
          type="button" className={css.close} aria-label={t('results.close')}
          onClick={() => { closeDetails() }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.tabs} role="tablist" aria-label={t('results.tabsLabel')}>
        {tabs.map(entry => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={css.tab}
            data-active={tab === entry.id || undefined}
            onClick={() => { setTab(entry.id) }}
          >
            {entry.label}
            {entry.count !== undefined && entry.count > 0
              ? <span className={css.tabCount}>{entry.count}</span>
              : null}
          </button>
        ))}
      </div>
      <div className={css.body} role="tabpanel">
        {tab === 'artifacts'
          ? (
            <PathList
              paths={produced}
              empty={t('results.artifactsEmpty')}
              cwdLabel={sessionCwd === undefined || sessionCwd === '' ? null : t('results.cwd', { path: sessionCwd })}
              openFile={openFile}
              openAria={path => t('results.openFile', { path })}
              kind="artifact"
            />
          )
          : tab === 'changes'
            ? (
              <PathList
                paths={produced}
                empty={t('results.changesEmpty')}
                cwdLabel={null}
                openFile={openFile}
                openAria={path => t('results.openFile', { path })}
                kind="change"
                changeLabel={t('results.changed')}
              />
            )
            : tab === 'files'
              ? (
                <PathList
                  paths={produced}
                  empty={t('results.filesEmpty')}
                  cwdLabel={sessionCwd === undefined || sessionCwd === '' ? null : t('results.cwd', { path: sessionCwd })}
                  openFile={openFile}
                  openAria={path => t('results.openFile', { path })}
                  kind="file"
                />
              )
              : selection === null || callId === undefined
                ? <div className={css.empty}>{t('details.empty')}</div>
                : material === null
                  ? <div className={css.empty}>{t('details.notInWindow')}</div>
                  : (
                    <>
                      <div className={css.inspectTitle}>{material.name}</div>
                      {material.argsRaw !== null && (
                        <section className={css.section}>
                          <div className={css.sectionLabel}>{t('details.input')}</div>
                          <CodeBlock code={pretty(material.argsRaw)} lang="json" copyLabel={t('copy')} copiedLabel={t('copied')} />
                        </section>
                      )}
                      <section className={css.section}>
                        <div className={css.sectionLabel}>{t('details.output')}</div>
                        <Fragment key={callId}>
                          {renderSlot('conversation.details.tool', { block: material.block, cwd: sessionCwd }, {
                            fallback: 'kind' in material.block
                              ? (
                                <pre className={css.code} data-error={material.block.isError || undefined}>
                                  {rawResultText(material.block)}
                                </pre>
                              )
                              : <div className={css.empty}>{t('details.running')}</div>,
                          })}
                        </Fragment>
                      </section>
                    </>
                  )}
      </div>
    </div>
  )
}

/**
 * Openable path list for artifacts / changes / files tabs.
 */
function PathList(props: {
  paths: readonly string[]
  empty: string
  cwdLabel: string | null
  openFile: (path: string) => Promise<void>
  openAria: (path: string) => string
  kind: 'artifact' | 'change' | 'file'
  changeLabel?: string
}): ReactNode {
  const { paths, empty, cwdLabel, openFile, openAria, kind, changeLabel } = props
  return (
    <div className={css.pathList} data-results-kind={kind}>
      {cwdLabel !== null ? <p className={css.cwd}>{cwdLabel}</p> : null}
      {paths.length === 0
        ? <div className={css.empty}>{empty}</div>
        : (
          <ul className={css.paths}>
            {paths.map(path => (
              <li key={path}>
                <button
                  type="button"
                  className={css.pathRow}
                  title={path}
                  aria-label={openAria(path)}
                  onClick={() => { void openFile(path) }}
                >
                  <span className={css.pathName}>{basename(path)}</span>
                  {kind === 'change' && changeLabel !== undefined
                    ? <span className={css.pathTag}>{changeLabel}</span>
                    : null}
                  <span className={css.pathFull}>{path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
