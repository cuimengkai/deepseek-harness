/**
 * The context view tab: a live read of one session's model-visible context
 * composition. The fixed summary header carries the model identity, the
 * log-revision marker, and the capacity meter (system prompt, tool catalog,
 * surface) against the recorded context window; the left tree lists the
 * envelope rows, the priced surface rows, and the compaction history; the
 * right pane renders the selected row's content. The read refreshes whenever
 * the conversation's last event moves (new message, tool call, compaction) —
 * the revision marker the runtime snapshot already carries. The root opts
 * into the conversation composer overlay: the header stays fixed while the
 * panes scroll under it, and the range action card floats above the composer.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CodeBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ContextCompositionState, ContextComposition } from './context-store.ts'
import type { NS } from './locales.ts'
import css from './context.module.css'

type ContextTranslate = TranslateNS<typeof NS>

/** Which tree row is selected, by stable identity. */
type Selection =
  | { kind: 'envelope-system' }
  | { kind: 'envelope-tools' }
  | { kind: 'surface'; seq: number }
  | { kind: 'compaction'; summarySeq: number }

/** The active compaction range, as inclusive surface seq endpoints. */
interface RangeSelection {
  readonly start: number
  readonly end: number
}

/** One label/value chip the detail header renders as a fact. */
interface Fact {
  readonly label: string
  readonly value: string
}

/** Business face of the context view registration. */
export interface ContextViewInjected {
  hooks: { contextComposition: SnapshotStore<ContextCompositionState> }
  load: () => void
  dispose: () => void
  /**
   * Execute /compact <start>:<end> over the commands Remote.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  compactRange: (start: number, end: number) => Promise<string | null>
}

/** Full props of the context view: standard conversation-view kit + inject + locale. */
export type ContextViewProps =
  ConvViewProps & InjectFace<ContextViewInjected> & PropsLocale<typeof NS>

/**
 * Compact token figure (the StatsLine convention): 999 stays absolute, 4.4K
 * from a thousand, 1.2M from a million.
 * @param n - token count.
 * @returns display figure.
 */
function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** The first non-empty line of a multi-line preview, elided to one row. */
function firstLine(text: string): string {
  return (text.split('\n', 1)[0] ?? '').trim()
}

/**
 * Renders the context tab: read the composition on mount and on every surface
 * revision, and present the summary header, tree, and detail pane.
 * @param props - composed conversation-view + inject + locale share.
 */
export function ContextView({ useSession, useContextComposition, load, dispose, compactRange, t }: ContextViewProps) {
  const state = useContextComposition(snapshot => snapshot)
  // The conversation's last event seq (+1 while a partial streams) is the
  // revision marker: a new message, tool call, or compaction moves it and the
  // read refreshes. The selector returns a primitive so re-renders only fire
  // on real movement.
  const revision = useSession((snapshot) => {
    const last = snapshot.nodes.length > 0
      ? snapshot.nodes[snapshot.nodes.length - 1]?.seq ?? 0
      : 0
    return last + (snapshot.partial !== null ? 1 : 0)
  })
  useEffect(() => {
    load()
  }, [load, revision])
  useEffect(() => dispose, [dispose])

  if (state.status === 'error') {
    return <Frame>{t('frame.error')}: {state.error}</Frame>
  }
  if (state.status === 'idle' || state.status === 'loading') return <Frame busy>{t('frame.loading')}</Frame>
  if (state.status === 'empty') return <Frame>{t('frame.empty')}</Frame>
  if (state.composition === null) return null
  return <ContextBody composition={state.composition} compactRange={compactRange} t={t} />
}

/**
 * One non-content frame state (loading, unread, empty), centered in the tab
 * area the way the app's other loading states present.
 * @param props - the busy flag and the frame copy.
 * @returns the centered frame block.
 */
function Frame({ busy = false, children }: { busy?: boolean; children: React.ReactNode }) {
  return (
    <div className={css.frameRoot} data-conversation-composer-overlay="">
      <div className={css.frame} role="status" aria-live={busy ? 'polite' : undefined}>
        {busy && <span className={css.frameSpinner} aria-hidden="true" />}
        <span>{children}</span>
      </div>
    </div>
  )
}

/** The composed body: fixed summary header + the left-tree/right-detail explorer. */
function ContextBody({
  composition, compactRange, t,
}: { composition: ContextComposition; compactRange: (start: number, end: number) => Promise<string | null>; t: ContextTranslate }) {
  const [selection, setSelection] = useState<Selection>({ kind: 'envelope-system' })
  const [range, setRange] = useState<RangeSelection | null>(null)
  const [compacting, setCompacting] = useState(false)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const anchorRef = useRef<number | null>(null)
  const { envelope, surface, surfaceTokens, contextWindow } = composition
  const systemTokens = envelope?.systemTokens ?? 0
  const toolsTokens = envelope?.toolsTokens ?? 0

  // A plain click re-anchors the range and clears any active selection; a
  // shift-click on a surface row extends the range from the anchor (a bare
  // shift-click with no anchor selects the clicked row alone).
  const handleSelect = (next: Selection): void => {
    if (next.kind === 'surface') anchorRef.current = next.seq
    setRange(null)
    setRangeError(null)
    setSelection(next)
  }
  const handleRangeExtend = (seq: number): void => {
    // A compaction refresh can drop the anchored row; a gone anchor re-anchors
    // on the clicked row rather than issuing a range the engine must reject.
    const anchored = anchorRef.current !== null && surface.some(row => row.seq === anchorRef.current)
      ? anchorRef.current
      : seq
    setRange({ start: Math.min(anchored, seq), end: Math.max(anchored, seq) })
    setRangeError(null)
    setSelection({ kind: 'surface', seq })
  }
  // The compaction trigger: an admitted execution clears the range (the
  // revision marker refreshes the composition); a rejection keeps it so the
  // user can retry or adjust.
  const triggerCompaction = (): void => {
    if (range === null || compacting) return
    setCompacting(true)
    setRangeError(null)
    void compactRange(range.start, range.end).then((failure) => {
      setCompacting(false)
      if (failure === null) setRange(null)
      else setRangeError(failure)
    })
  }
  // Escape dismisses the active range, the same key the app's floating
  // surfaces (ContextMeter's panel) close on.
  useEffect(() => {
    if (range === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setRange(null)
        setRangeError(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [range])
  return (
    <div className={css.root} data-context-view="" data-conversation-composer-overlay="">
      <SummaryHeader
        systemTokens={systemTokens}
        toolsTokens={toolsTokens}
        surfaceTokens={surfaceTokens}
        contextWindow={contextWindow}
        envelope={envelope}
        logRevision={composition.logRevision}
        showHint={range === null && !compacting}
        t={t}
      />
      <div className={css.columns}>
        <ContextTree
          composition={composition}
          selection={selection}
          range={range}
          onSelect={handleSelect}
          onRangeExtend={handleRangeExtend}
          t={t}
        />
        <ContextDetail composition={composition} selection={selection} t={t} />
      </div>
      {range !== null && (
        <div className={css.rangeBar} data-context-range="">
          <span className={css.rangeInfo}>{t('range.selected', {
            count: String(surface.filter(row => row.seq >= range.start && row.seq <= range.end).length),
            tokens: String(surface
              .filter(row => row.seq >= range.start && row.seq <= range.end)
              .reduce((sum, row) => sum + row.tokens, 0)),
          })}</span>
          <button
            type="button"
            className={css.rangeCompact}
            onClick={triggerCompaction}
            disabled={compacting}
          >
            {compacting ? t('range.compacting') : t('range.compact')}
          </button>
          <button
            type="button"
            className={css.rangeClear}
            onClick={() => { setRange(null); setRangeError(null) }}
            disabled={compacting}
          >
            {t('range.clear')}
          </button>
          {rangeError !== null && <span className={css.rangeError} role="alert">{rangeError}</span>}
        </div>
      )}
    </div>
  )
}

/* ── summary header ─────────────────────────────────────────────────────── */

/**
 * The fixed header: model identity and log revision on the first line, the
 * segmented capacity meter below it, and the legend chips with the free tail
 * (or the unknown-window notice) under that. Percentages clamp to 100% so a
 * window-less over-estimate cannot break the layout.
 */
function SummaryHeader({
  systemTokens, toolsTokens, surfaceTokens, contextWindow, envelope, logRevision, showHint, t,
}: {
  systemTokens: number
  toolsTokens: number
  surfaceTokens: number
  contextWindow: number | null
  envelope: ContextComposition['envelope']
  logRevision: number
  showHint: boolean
  t: ContextTranslate
}) {
  const used = systemTokens + toolsTokens + surfaceTokens
  const scale = contextWindow !== null && contextWindow > 0 ? Math.min(1, used / contextWindow) : 0
  const percent = contextWindow !== null && contextWindow > 0
    ? Math.min(100, Math.round(used / contextWindow * 100))
    : null
  // Segment width is the part's share of the window scaled into the used
  // fraction; zero-width parts are dropped rather than rendered as hairlines.
  const segment = (tokens: number): string => {
    if (contextWindow === null || contextWindow <= 0) return '0%'
    return `${((tokens / contextWindow) * scale * 100).toFixed(2)}%`
  }
  return (
    <header className={css.summary}>
      <div className={css.summaryHead}>
        <span className={css.summaryModel}>{envelope === null ? t('label.noRequest') : envelope.model}</span>
        {envelope !== null && <span className={css.summaryProvider}>{envelope.provider}</span>}
        <span className={css.summaryStats}>
          {contextWindow === null
            ? formatTokens(used)
            : `${t('label.usedWindow', { used: formatTokens(used), window: formatTokens(contextWindow) })} · ${percent}%`}
        </span>
        <span className={css.summaryRevision}>{t('label.logRevision', { revision: String(logRevision) })}</span>
      </div>
      <div className={css.capacityBar} role="img" aria-label={t('label.capacity', { tokens: formatTokens(used) })}>
        {systemTokens > 0 && <span className={css.capacitySystem} style={{ width: segment(systemTokens) }} />}
        {toolsTokens > 0 && <span className={css.capacityTools} style={{ width: segment(toolsTokens) }} />}
        {surfaceTokens > 0 && <span className={css.capacitySurface} style={{ width: segment(surfaceTokens) }} />}
      </div>
      <div className={css.capacityLegend}>
        <span className={css.capacityItem}><i className={`${css.swatch} ${css.capacitySystem}`} />{t('row.system')} · {t('label.tokens', { count: formatTokens(systemTokens) })}</span>
        <span className={css.capacityItem}><i className={`${css.swatch} ${css.capacityTools}`} />{t('row.tools')} · {t('label.tokens', { count: formatTokens(toolsTokens) })}</span>
        <span className={css.capacityItem}><i className={`${css.swatch} ${css.capacitySurface}`} />{t('group.surface')} · {t('label.tokens', { count: formatTokens(surfaceTokens) })}</span>
        {contextWindow !== null
          ? <span className={css.capacityItem}>{t('label.free', { tokens: formatTokens(Math.max(0, contextWindow - used)) })}</span>
          : <span className={css.capacityItem}>{t('label.unknownCapacity')}</span>}
        {showHint && <span className={css.capacityHint}>{t('range.hint')}</span>}
      </div>
    </header>
  )
}

/* ── left tree ──────────────────────────────────────────────────────────── */

/** One selectable row of the context tree. */
interface TreeRow {
  readonly id: string
  readonly selection: Selection
  /** The row's main label. */
  readonly label: string
  /** Inline preview after the label (a surface row's text, a compaction's summary). */
  readonly preview: string | null
  /** The surface row's role, rendered as the leading chip. */
  readonly role: string | null
  /** The surface row's stable identity for its accessible name, `#seq role`. */
  readonly ariaLabel: string | null
  /** The right-aligned token figure. */
  readonly tokens: string
}

/** One tree group: a sticky title with row count and summed tokens. */
interface TreeGroup {
  readonly id: string
  readonly title: string
  readonly rows: readonly TreeRow[]
  /** The group's summed token figure, right-aligned in the title. */
  readonly tokens: string
}

/**
 * The grouped flat tree: the envelope group (system prompt, tool catalog),
 * the surface group (one row per priced message), and the compaction group.
 * Rows are buttons; the selected row carries the active accent and a surface
 * row inside the compaction range carries the range tint.
 */
function ContextTree({
  composition, selection, range, onSelect, onRangeExtend, t,
}: {
  composition: ContextComposition
  selection: Selection
  range: RangeSelection | null
  onSelect: (next: Selection) => void
  onRangeExtend: (seq: number) => void
  t: ContextTranslate
}) {
  const { envelope, surface, compactions } = composition
  const groups = useMemo<TreeGroup[]>(() => {
    const envelopeRows: TreeRow[] = [
      {
        id: 'envelope-system',
        selection: { kind: 'envelope-system' },
        label: t('row.system'),
        preview: null,
        role: null,
        ariaLabel: null,
        tokens: t('label.tokens', { count: String(envelope?.systemTokens ?? 0) }),
      },
      {
        id: 'envelope-tools',
        selection: { kind: 'envelope-tools' },
        label: t('row.tools'),
        preview: envelope === null ? null : t('label.toolsCount', { count: String(envelope.tools.length) }),
        role: null,
        ariaLabel: null,
        tokens: t('label.tokens', { count: String(envelope?.toolsTokens ?? 0) }),
      },
    ]
    const surfaceRows: TreeRow[] = surface.map(row => ({
      id: `surface-${row.seq}`,
      selection: { kind: 'surface', seq: row.seq },
      label: `#${row.seq}`,
      preview: row.preview,
      role: row.role,
      ariaLabel: t('row.surfaceMessage', { seq: String(row.seq), role: row.role }),
      tokens: t('label.tokens', { count: String(row.tokens) }),
    }))
    const compactionRows: TreeRow[] = compactions.map(entry => ({
      id: `compaction-${entry.summarySeq}`,
      selection: { kind: 'compaction', summarySeq: entry.summarySeq },
      label: t('row.compaction', { seq: String(entry.summarySeq) }),
      preview: entry.summary === null ? null : firstLine(entry.summary),
      role: null,
      ariaLabel: null,
      tokens: t('label.tokens', { count: String(entry.shadowedTokens) }),
    }))
    const compactionTokens = compactions.reduce((sum, entry) => sum + entry.shadowedTokens, 0)
    return [
      {
        id: 'group-envelope',
        title: t('group.envelope'),
        rows: envelopeRows,
        tokens: formatTokens((envelope?.systemTokens ?? 0) + (envelope?.toolsTokens ?? 0)),
      },
      { id: 'group-surface', title: t('group.surface'), rows: surfaceRows, tokens: formatTokens(composition.surfaceTokens) },
      { id: 'group-compactions', title: t('group.compactions'), rows: compactionRows, tokens: formatTokens(compactionTokens) },
    ]
  }, [envelope, surface, compactions, t, composition.surfaceTokens])
  return (
    <nav className={css.tree} aria-label={t('view.context')}>
      {groups.map(group => (
        <section key={group.id} className={css.treeGroup}>
          <h3 className={css.treeGroupTitle}>
            <span className={css.treeGroupLabel}>{group.title}</span>
            <span className={css.treeGroupCount}>{group.rows.length}</span>
            <span className={css.treeGroupTokens}>{group.tokens}</span>
          </h3>
          {group.rows.map((row) => {
            const active = selectionKindEquals(selection, row.selection)
            const inRange = range !== null
              && row.selection.kind === 'surface'
              && row.selection.seq >= range.start
              && row.selection.seq <= range.end
            const className = [
              active ? css.treeRowActive : css.treeRow,
              inRange ? css.treeRowRange : '',
            ].filter(Boolean).join(' ')
            return (
              <button
                key={row.id}
                type="button"
                className={className}
                aria-selected={inRange}
                aria-label={row.ariaLabel ?? undefined}
                onClick={(event) => {
                  if (event.shiftKey && row.selection.kind === 'surface') onRangeExtend(row.selection.seq)
                  else onSelect(row.selection)
                }}
              >
                {row.role !== null && (
                  <span className={row.role === 'user' ? `${css.roleChip} ${css.roleUser}` : `${css.roleChip} ${css.roleAssistant}`}>{row.role}</span>
                )}
                <span className={css.rowMain}>
                  <span className={css.rowLabel}>{row.label}</span>
                  {row.preview !== null && <span className={css.rowPreview}>{row.preview}</span>}
                </span>
                <span className={css.rowMeta}>{row.tokens}</span>
              </button>
            )
          })}
        </section>
      ))}
    </nav>
  )
}

function selectionKindEquals(left: Selection, right: Selection): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case 'surface': return left.seq === (right as Extract<Selection, { kind: 'surface' }>).seq
    case 'compaction': return left.summarySeq === (right as Extract<Selection, { kind: 'compaction' }>).summarySeq
    default: return true
  }
}

/* ── right detail ───────────────────────────────────────────────────────── */

/** Render the selected row's content: system prompt, tools, message, or compaction. */
function ContextDetail({
  composition, selection, t,
}: { composition: ContextComposition; selection: Selection; t: ContextTranslate }) {
  const { envelope, surface, compactions } = composition
  const bodyRef = useRef<HTMLDivElement>(null)
  // A row switch re-renders the pane's content; reset the scroll so a new
  // selection always opens at its top instead of the previous row's offset.
  useLayoutEffect(() => {
    if (bodyRef.current !== null) bodyRef.current.scrollTop = 0
  }, [selection])
  switch (selection.kind) {
    case 'envelope-system': {
      if (envelope === null) return <EmptyDetail text={t('frame.empty')} />
      const facts: Fact[] = [
        { label: t('label.provider'), value: envelope.provider },
        { label: t('label.model'), value: envelope.model },
        { label: 'tokens', value: String(envelope.systemTokens) },
      ]
      return (
        <DetailPane header={<DetailHeader title={t('label.systemTitle')} facts={facts} />} bodyRef={bodyRef}>
          {envelope.system === null
            ? <p className={css.muted}>{t('label.noPreview')}</p>
            : <div className={css.prose}><MarkdownText text={envelope.system} /></div>}
        </DetailPane>
      )
    }
    case 'envelope-tools': {
      if (envelope === null) return <EmptyDetail text={t('frame.empty')} />
      const facts: Fact[] = [
        { label: t('label.provider'), value: envelope.provider },
        { label: t('label.model'), value: envelope.model },
        { label: t('label.toolsCount'), value: String(envelope.tools.length) },
        { label: 'tokens', value: String(envelope.toolsTokens) },
      ]
      return (
        <DetailPane header={<DetailHeader title={t('label.toolsTitle')} facts={facts} />} bodyRef={bodyRef}>
          {envelope.tools.length === 0
            ? <p className={css.muted}>{t('empty.surface')}</p>
            : (
              <table className={css.table}>
                <thead>
                  <tr><th>name</th><th>tokens</th></tr>
                </thead>
                <tbody>
                  {envelope.tools.map(tool => (
                    <tr key={tool.name}>
                      <td>{tool.name}</td>
                      <td className={css.tableNumber}>{tool.tokens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </DetailPane>
      )
    }
    case 'surface': {
      const row = surface.find(candidate => candidate.seq === selection.seq)
      if (row === undefined) return <EmptyDetail text={t('frame.empty')} />
      const facts: Fact[] = [
        { label: t('label.seq'), value: String(row.seq) },
        { label: t('label.role'), value: row.role },
        { label: 'tokens', value: String(row.tokens) },
      ]
      return (
        <DetailPane header={<DetailHeader title={t('row.surfaceMessage', { seq: String(row.seq), role: row.role })} facts={facts} />} bodyRef={bodyRef}>
          <div className={css.prose}>
            {row.preview === null
              ? <p className={css.muted}>{t('label.noPreview')}</p>
              : <MarkdownText text={row.preview} />}
          </div>
        </DetailPane>
      )
    }
    case 'compaction': {
      const entry = compactions.find(candidate => candidate.summarySeq === selection.summarySeq)
      if (entry === undefined) return <EmptyDetail text={t('frame.empty')} />
      const facts: Fact[] = [
        { label: t('label.provider'), value: entry.provider },
        { label: t('label.model'), value: entry.model },
      ]
      return (
        <DetailPane header={<DetailHeader title={t('label.compactionTitle')} facts={facts} />} bodyRef={bodyRef}>
          <p className={css.muted}>
            {t('label.shadowed', { count: String(entry.shadowedCount), tokens: String(entry.shadowedTokens) })}
          </p>
          <h4 className={css.detailSubTitle}>{t('label.summary')}</h4>
          {entry.summary === null
            ? <p className={css.muted}>{t('label.noPreview')}</p>
            : (
              <CodeBlock
                code={entry.summary}
                lang="markdown"
                copyLabel={t('label.copy')}
                copiedLabel={t('label.copied')}
              />
            )}
        </DetailPane>
      )
    }
  }
}

/** The detail pane's shared frame: header block plus scrolling content. */
function DetailPane({ header, bodyRef, children }: {
  header: React.ReactNode
  bodyRef: React.RefObject<HTMLDivElement>
  children: React.ReactNode
}) {
  return (
    <section className={css.detail}>
      {header}
      <div className={css.detailBody} ref={bodyRef}>{children}</div>
    </section>
  )
}

/** One detail header: title line plus the fact chips row. */
function DetailHeader({ title, facts }: { title: string; facts: readonly Fact[] }) {
  return (
    <header className={css.detailHeader}>
      <h3 className={css.detailTitle}>{title}</h3>
      <div className={css.factRow}>
        {facts.map(fact => (
          <span key={fact.label} className={css.fact}>
            <span className={css.factLabel}>{fact.label}</span>
            <span className={css.factValue}>{fact.value}</span>
          </span>
        ))}
      </div>
    </header>
  )
}

/** The detail pane's fallback when the selected row no longer resolves. */
function EmptyDetail({ text }: { text: string }) {
  return (
    <section className={css.detail}>
      <div className={css.detailBody}><p className={css.muted}>{text}</p></div>
    </section>
  )
}
